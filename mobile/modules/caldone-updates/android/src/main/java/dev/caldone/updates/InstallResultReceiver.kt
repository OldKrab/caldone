package dev.caldone.updates

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller

/** Explicit, non-exported receiver addressed by the installer PendingIntent.
 * Never opens UI from the background. JS rechecks active work before confirmation. */
class InstallResultReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val store = ApkStore(context)
    if (intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID, -2) != store.prefs.getInt("session", -1)) return
    activeSessionId = store.prefs.getInt("session", -1)
    when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
      PackageInstaller.STATUS_PENDING_USER_ACTION -> {
        @Suppress("DEPRECATION")
        val confirmation = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
        pendingConfirmation = confirmation
        store.status(if (confirmation != null) "confirmation" else "error", if (confirmation == null) "install" else "")
      }
      PackageInstaller.STATUS_SUCCESS -> {
        store.apk.delete()
        store.prefs.edit().clear().commit()
        pendingConfirmation = null
      }
      else -> {
        pendingConfirmation = null
        val code = when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, 1)) {
          PackageInstaller.STATUS_FAILURE_STORAGE -> "storage"
          PackageInstaller.STATUS_FAILURE_BLOCKED -> "permission"
          PackageInstaller.STATUS_FAILURE_ABORTED -> "cancelled"
          PackageInstaller.STATUS_FAILURE_INVALID -> "integrity"
          PackageInstaller.STATUS_FAILURE_INCOMPATIBLE -> "incompatible"
          else -> "install"
        }
        store.status("error", code)
      }
    }
  }
  companion object {
    @Volatile var pendingConfirmation: Intent? = null
    @Volatile var activeSessionId = -1
  }
}
