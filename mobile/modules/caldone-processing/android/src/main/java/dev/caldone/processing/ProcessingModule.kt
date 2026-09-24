package dev.caldone.processing

import android.content.Intent
import android.os.Build
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ProcessingModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CalDoneProcessing")
    AsyncFunction("start") { title: String, body: String ->
      val context = appContext.reactContext ?: throw IllegalStateException("App context unavailable")
      val intent = Intent(context, ProcessingService::class.java).putExtra("title", title).putExtra("body", body)
      // Start while the user is foregrounded, before beginning network work.
      // Android may reject new services from background; propagate that failure.
      if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
      Unit
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("stop") {
      appContext.reactContext?.let { it.stopService(Intent(it, ProcessingService::class.java)) }
    }.runOnQueue(Queues.MAIN)
  }
}
