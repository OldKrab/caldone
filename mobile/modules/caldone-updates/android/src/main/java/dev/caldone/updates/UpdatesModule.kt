package dev.caldone.updates

import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import com.facebook.react.common.LifecycleState
import com.facebook.react.bridge.ReactContext

class DownloadRequest : Record {
  @Field var downloadUrl: String = ""
  @Field var size: Long = 0
  @Field var sha256: String = ""
}

class UpdatesModule : Module() {
  private fun store() = ApkStore(appContext.reactContext ?: error("unavailable"))
  private val foreground get() = (appContext.reactContext as? ReactContext)?.lifecycleState == LifecycleState.RESUMED
  private fun activity() = appContext.currentActivity?.takeIf { foreground && !it.isFinishing } ?: error("busy")
  override fun definition() = ModuleDefinition {
    Name("CalDoneUpdates")
    Function("installed") {
      val store = store()
      mapOf("version" to (store.installed().versionName ?: ""), "versionCode" to store.version(store.installed()),
        "supported" to store.supported(), "abis" to Build.SUPPORTED_ABIS.toList())
    }
    Function("state") {
      val store = store()
      var status = store.prefs.getString("status", "idle")!!
      if (status == "downloading" && !UpdateDownload.running.get()) {
        store.partial.delete()
        store.status("error", "interrupted")
        status = "error"
      }
      // A process restart loses the system confirmation Intent. Keep the APK,
      // but require an explicit retry that replaces the old session safely.
      if (status == "confirmation" && InstallResultReceiver.pendingConfirmation == null) {
        store.status("ready"); status = "ready"
      }
      if (status == "installing" && store.installed().lastUpdateTime > store.prefs.getLong("started", Long.MAX_VALUE)) {
        store.apk.delete(); store.prefs.edit().clear().commit(); status = "idle"
      }
      if (status == "installing" && InstallResultReceiver.activeSessionId != store.prefs.getInt("session", -1)) {
        store.status("error", "interrupted"); status = "error"
      }
      mapOf("status" to status, "progress" to UpdateDownload.progress,
        "error" to store.prefs.getString("error", ""), "sha256" to store.prefs.getString("sha256", ""))
    }
    AsyncFunction("download") { request: DownloadRequest ->
      UpdateDownload.download(store(), request.downloadUrl, request.size, request.sha256)
    }
    Function("cancel") { UpdateDownload.cancel() }
    Function("canInstall") { Build.VERSION.SDK_INT < 26 || store().let { appContext.reactContext!!.packageManager.canRequestPackageInstalls() } }
    AsyncFunction("authorize") {
      val current = activity()
      if (Build.VERSION.SDK_INT >= 26) current.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
        Uri.parse("package:${current.packageName}")))
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("install") {
      check(foreground) { "busy" }
      check(!UpdateDownload.running.get()) { "busy" }
      val store = store()
      store.validateReady()
      val context = appContext.reactContext ?: error("unavailable")
      check(Build.VERSION.SDK_INT < 26 || context.packageManager.canRequestPackageInstalls()) { "permission" }
      val installer = context.packageManager.packageInstaller
      val previous = store.prefs.getInt("session", -1)
      if (previous != -1) runCatching { installer.abandonSession(previous) }
      val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
        setAppPackageName(context.packageName)
        setSize(store.apk.length())
        if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED)
      }
      val sessionId = installer.createSession(params)
      try {
        check(store.prefs.edit().putInt("session", sessionId).putLong("started", System.currentTimeMillis()).commit()) { "storage" }
        installer.openSession(sessionId).use { session ->
          session.openWrite("base.apk", 0, store.apk.length()).use { output ->
            store.apk.inputStream().use { it.copyTo(output) }; session.fsync(output)
          }
          check(foreground) { "busy" }
          val callback = Intent(context, InstallResultReceiver::class.java)
          // Android fills status/session extras; mutability is limited to this explicit receiver.
          val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
          store.status("installing")
          InstallResultReceiver.activeSessionId = sessionId
          session.commit(PendingIntent.getBroadcast(context, sessionId, callback, flags).intentSender)
        }
      } catch (error: Exception) {
        runCatching { installer.abandonSession(sessionId) }
        store.status("error", error.message ?: "install")
        throw error
      }
    }
    AsyncFunction("confirm") {
      val current = activity()
      val intent = InstallResultReceiver.pendingConfirmation ?: error("interrupted")
      current.startActivity(intent)
      InstallResultReceiver.pendingConfirmation = null
      store().status("installing")
    }.runOnQueue(Queues.MAIN)
  }
}
