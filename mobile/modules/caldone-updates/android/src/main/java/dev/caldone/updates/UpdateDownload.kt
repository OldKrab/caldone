package dev.caldone.updates

import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicBoolean

/** One bounded download per process. Interrupted transfers never become installable;
 * the next explicit attempt starts over. Complete APKs survive process restarts. */
object UpdateDownload {
  val running = AtomicBoolean(false)
  private val cancelled = AtomicBoolean(false)
  @Volatile var progress = 0.0
  @Volatile private var connection: HttpURLConnection? = null
  fun cancel() { cancelled.set(true); connection?.disconnect() }

  fun download(store: ApkStore, url: String, size: Long, sha256: String) {
    check(store.prefs.getString("status", "idle") !in setOf("installing", "confirmation")) { "busy" }
    check(running.compareAndSet(false, true)) { "busy" }
    cancelled.set(false)
    progress = 0.0
    try {
      check(Regex("https://github\\.com/OldKrab/caldone/releases/download/v[0-9]+\\.[0-9]+\\.[0-9]+/caldone-[0-9]+\\.[0-9]+\\.[0-9]+-arm64\\.apk").matches(url)) { "source" }
      check(size in 1..(512L * 1024 * 1024) && Regex("[a-f0-9]{64}").matches(sha256)) { "integrity" }
      check(store.supported()) { "signature" }
      if (store.apk.exists() && store.prefs.getString("sha256", "") == sha256) {
        store.validate(store.apk, size, sha256)
        store.status("ready")
        return
      }
      store.partial.delete()
      store.apk.delete()
      check(store.directory.usableSpace > size * 2 + 16 * 1024 * 1024) { "storage" }
      check(store.prefs.edit().putString("sha256", sha256).putLong("size", size).commit()) { "storage" }
      store.status("downloading")
      var target = URL(url)
      var response: HttpURLConnection? = null
      for (attempt in 0..5) {
        check(!cancelled.get()) { "cancelled" }
        check(target.protocol == "https" && (target.host == "github.com" || target.host == "release-assets.githubusercontent.com"
          || target.host == "objects.githubusercontent.com")) { "source" }
        val next = (target.openConnection() as HttpURLConnection).apply {
          instanceFollowRedirects = false; connectTimeout = 15_000; readTimeout = 20_000
          setRequestProperty("Accept-Encoding", "identity")
        }
        connection = next
        val code = next.responseCode
        if (code in listOf(301, 302, 303, 307, 308)) {
          val location = next.getHeaderField("Location") ?: error("network")
          target = URL(target, location)
          next.disconnect()
        } else { check(code == 200) { "network" }; response = next; break }
      }
      val source = response ?: error("network")
      val deadline = System.nanoTime() + 15L * 60 * 1_000_000_000
      source.inputStream.use { input -> FileOutputStream(store.partial).use { output ->
        val buffer = ByteArray(64 * 1024)
        var total = 0L
        while (true) {
          check(!cancelled.get()) { "cancelled" }
          check(System.nanoTime() < deadline) { "network" }
          val count = input.read(buffer)
          if (count < 0) break
          total += count
          check(total <= size) { "integrity" }
          output.write(buffer, 0, count)
          progress = total.toDouble() / size
        }
        output.fd.sync()
      } }
      check(!cancelled.get()) { "cancelled" }
      store.validate(store.partial, size, sha256)
      check(!cancelled.get()) { "cancelled" }
      check(store.partial.renameTo(store.apk)) { "storage" }
      store.status("ready")
    } catch (error: Exception) {
      store.partial.delete()
      store.apk.delete()
      val reason = if (cancelled.get()) "cancelled" else error.message ?: "network"
      store.status(if (reason == "cancelled") "idle" else "error", reason)
      throw error
    } finally { connection?.disconnect(); connection = null; running.set(false) }
  }
}
