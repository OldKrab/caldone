package dev.caldone.loopback

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.Locale
import kotlin.concurrent.thread

private const val PORT = 1455
private const val CALLBACK_PATH = "/auth/callback"
private const val APP_RETURN_URI = "caldone://oauth-complete"
private const val MAX_HEADER_CHARS = 16_384

class CodexLoopbackModule : Module() {
  private val lock = Any()
  private var server: ServerSocket? = null
  private var resultPromise: Promise? = null
  private var pendingCode: String? = null
  private var pendingError: Exception? = null

  override fun definition() = ModuleDefinition {
    Name("CodexLoopback")

    AsyncFunction("start") { expectedState: String ->
      startServer(expectedState)
    }

    AsyncFunction("waitForCode") { promise: Promise ->
      waitForCode(promise)
    }

    Function("cancel") { message: String ->
      fail(IllegalStateException(message))
    }

    Function("close") {
      closeServer()
    }

    OnDestroy {
      fail(IllegalStateException("OAuth callback listener was destroyed"))
    }
  }

  private fun startServer(expectedState: String) {
    fail(IllegalStateException("OAuth callback listener was restarted"))

    val newServer = ServerSocket().apply {
      reuseAddress = true
      bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), PORT))
    }

    synchronized(lock) {
      server = newServer
      pendingCode = null
      pendingError = null
    }

    thread(name = "codex-oauth-loopback", isDaemon = true) {
      acceptCallbacks(newServer, expectedState)
    }
  }

  private fun waitForCode(promise: Promise) {
    val code: String?
    val error: Exception?
    synchronized(lock) {
      code = pendingCode
      error = pendingError
      if (code == null && error == null) {
        if (server == null) {
          promise.reject("ERR_LOOPBACK_NOT_STARTED", "OAuth callback listener is not running", null)
        } else if (resultPromise != null) {
          promise.reject("ERR_LOOPBACK_ALREADY_WAITING", "OAuth callback listener already has a waiter", null)
        } else {
          resultPromise = promise
        }
        return
      }
    }

    if (code != null) {
      promise.resolve(code)
    } else {
      promise.reject("ERR_LOOPBACK", error?.message ?: "OAuth callback failed", error)
    }
  }

  private fun acceptCallbacks(activeServer: ServerSocket, expectedState: String) {
    try {
      while (!activeServer.isClosed) {
        activeServer.accept().use { socket ->
          handleRequest(socket, expectedState)
        }
      }
    } catch (error: Exception) {
      val isStillActive = synchronized(lock) { server === activeServer }
      if (isStillActive) fail(error)
    }
  }

  private fun handleRequest(socket: Socket, expectedState: String) {
    socket.soTimeout = 10_000
    val reader = BufferedReader(InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8))
    val requestLine = reader.readLine() ?: return
    var headerCharacters = requestLine.length
    while (true) {
      val line = reader.readLine() ?: break
      headerCharacters += line.length
      if (headerCharacters > MAX_HEADER_CHARS) {
        respond(socket, "431 Request Header Fields Too Large", "Request too large.")
        return
      }
      if (line.isEmpty()) break
    }

    val requestParts = requestLine.split(' ', limit = 3)
    if (requestParts.size < 2 || requestParts[0] != "GET") {
      respond(socket, "405 Method Not Allowed", "Only GET is supported.")
      return
    }

    val callback = try {
      URI("http://localhost${requestParts[1]}")
    } catch (_: Exception) {
      respond(socket, "400 Bad Request", "Invalid OAuth callback.")
      return
    }
    if (callback.path != CALLBACK_PATH) {
      respond(socket, "404 Not Found", "Callback route not found.")
      return
    }

    val query = parseQuery(callback.rawQuery)
    if (query["state"] != expectedState) {
      respond(socket, "400 Bad Request", loginPage(copy(
        "This response belongs to an old or different sign-in attempt. Return to CalDone and start a fresh sign-in.",
        "Этот ответ относится к старой или другой попытке входа. Вернитесь в CalDone и начните вход заново."
      ), "AUTH_CALLBACK_STATE"))
      // An old browser tab must not terminate the currently valid listener.
      return
    }

    query["error"]?.let { oauthError ->
      val sessionMismatch = oauthError == "request_forbidden" &&
        query["error_description"]?.contains("CSRF", ignoreCase = true) == true
      val reason = if (sessionMismatch) "csrf_mismatch" else "provider_rejected"
      val message = if (sessionMismatch) copy(
        "The browser login session changed or expired. Close old OpenAI login tabs and start a fresh sign-in from CalDone.",
        "Сессия входа в браузере изменилась или истекла. Закройте старые вкладки входа OpenAI и начните новую попытку из CalDone."
      ) else copy(
        "The sign-in service declined this attempt. Return to CalDone to see the error and try again.",
        "Сервис отклонил попытку входа. Вернитесь в CalDone, чтобы увидеть ошибку и повторить вход."
      )
      respond(socket, "400 Bad Request", loginPage(message,
        if (sessionMismatch) "AUTH_BROWSER_SESSION" else "AUTH_PROVIDER_REJECTED"))
      // Preserve a safe classification, never the provider's raw description,
      // which can contain URLs or other authorization-session data.
      fail(IllegalStateException("OpenAI login failed: $reason"))
      return
    }

    val code = query["code"]
    if (code.isNullOrEmpty()) {
      respond(socket, "400 Bad Request", loginPage(copy(
        "The sign-in response did not contain a login code. Return to CalDone and start a fresh sign-in.",
        "В ответе сервиса нет кода входа. Вернитесь в CalDone и начните вход заново."
      ), "AUTH_CALLBACK_CODE"))
      return
    }

    respond(socket, "200 OK", successPage())
    complete(code)
  }

  private fun parseQuery(rawQuery: String?): Map<String, String> {
    if (rawQuery.isNullOrEmpty()) return emptyMap()
    return rawQuery.split('&').mapNotNull { part ->
      val separator = part.indexOf('=')
      val rawName = if (separator >= 0) part.substring(0, separator) else part
      val rawValue = if (separator >= 0) part.substring(separator + 1) else ""
      try {
        URLDecoder.decode(rawName, StandardCharsets.UTF_8.name()) to
          URLDecoder.decode(rawValue, StandardCharsets.UTF_8.name())
      } catch (_: IllegalArgumentException) {
        null
      }
    }.toMap()
  }

  private fun respond(socket: Socket, status: String, body: String) {
    val bodyBytes = body.toByteArray(StandardCharsets.UTF_8)
    val headers = buildString {
      append("HTTP/1.1 $status\r\n")
      append("Cache-Control: no-store\r\n")
      append("Connection: close\r\n")
      append("Content-Length: ${bodyBytes.size}\r\n")
      append("Content-Type: text/html; charset=utf-8\r\n\r\n")
    }.toByteArray(StandardCharsets.US_ASCII)
    socket.getOutputStream().apply {
      write(headers)
      write(bodyBytes)
      flush()
    }
  }

  private fun copy(english: String, russian: String): String =
    if (Locale.getDefault().language == "ru") russian else english

  // Only app-owned copy and fixed diagnostic codes belong in this HTML.
  // Never interpolate callback parameters or provider error descriptions.
  private fun loginPage(message: String, code: String? = null, returnAutomatically: Boolean = false): String {
    val diagnostic = if (code == null) "" else "<p>[$code]</p>"
    val returnLabel = copy("Return to CalDone", "Вернуться в CalDone")
    val redirect = if (returnAutomatically) "<script>location.replace('$APP_RETURN_URI')</script>" else ""
    return """<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>CalDone login</title></head><body><p>$message</p>$diagnostic<p><a href="$APP_RETURN_URI">$returnLabel</a></p>$redirect</body></html>"""
  }

  private fun successPage(): String = loginPage(copy(
    "Authorization received. Returning to CalDone to finish connecting. Check the app for the final result.",
    "Авторизация получена. Возвращаемся в CalDone для завершения подключения. Итоговый результат появится в приложении."
  ), returnAutomatically = true)

  private fun complete(code: String) {
    val promise = synchronized(lock) {
      pendingCode = code
      pendingError = null
      resultPromise.also { resultPromise = null }
    }
    promise?.resolve(code)
    closeServer()
  }

  private fun fail(error: Exception) {
    val promise = synchronized(lock) {
      pendingCode = null
      pendingError = error
      resultPromise.also { resultPromise = null }
    }
    promise?.reject("ERR_LOOPBACK", error.message ?: "OAuth callback failed", error)
    closeServer()
  }

  private fun closeServer() {
    val activeServer = synchronized(lock) {
      server.also { server = null }
    }
    try {
      activeServer?.close()
    } catch (_: Exception) {
      // Closing is best effort; the pending result has already been delivered.
    }
  }
}
