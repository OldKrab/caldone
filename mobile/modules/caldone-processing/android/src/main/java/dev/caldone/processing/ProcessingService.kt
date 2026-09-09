package dev.caldone.processing

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager

/** Keeps the existing JS inference alive across app switches. It does not
 * restart JS after process death; persisted queued meals remain WorkManager-owned. */
class ProcessingService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null
  private val handler = Handler(Looper.getMainLooper())
  private val expire = Runnable { stopSelf() }
  override fun onBind(intent: Intent?): IBinder? = null
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val channel = "caldone-active-analysis"
    if (Build.VERSION.SDK_INT >= 26) {
      getSystemService(NotificationManager::class.java).createNotificationChannel(
        NotificationChannel(channel, "Meal analysis", NotificationManager.IMPORTANCE_LOW).apply { setSound(null, null) }
      )
    }
    val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, channel) else Notification.Builder(this)
    builder.setContentTitle(intent?.getStringExtra("title") ?: "CalDone")
      .setContentText(intent?.getStringExtra("body") ?: "Analyzing meal")
      .setSmallIcon(android.R.drawable.ic_menu_recent_history)
      .setOngoing(true).setOnlyAlertOnce(true).setCategory(Notification.CATEGORY_PROGRESS)
    packageManager.getLaunchIntentForPackage(packageName)?.let {
      builder.setContentIntent(PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
    }
    startForeground(4102, builder.build())
    if (wakeLock?.isHeld != true) {
      wakeLock = (getSystemService(POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "CalDone:analysis").apply { acquire(10 * 60_000L) }
    }
    // A final safety bound if JS is terminated before its normal finally cleanup.
    handler.removeCallbacks(expire)
    handler.postDelayed(expire, 10 * 60_000L)
    return START_NOT_STICKY
  }
  override fun onTimeout(startId: Int, fgsType: Int) { stopSelf() }
  override fun onDestroy() {
    handler.removeCallbacks(expire)
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }
}
