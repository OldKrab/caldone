package dev.caldone.updates

import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import java.io.File
import java.security.MessageDigest
import java.util.zip.ZipFile

/** Only this app's private cache is exposed to the installer, via a session.
 * No file URI, exported provider, broad storage permission, or caller-supplied path. */
class ApkStore(private val context: Context) {
  val prefs = context.getSharedPreferences("caldone.updates", Context.MODE_PRIVATE)
  val directory = File(context.cacheDir, "updates").apply { mkdirs() }
  val partial = File(directory, "download.part")
  val apk = File(directory, "update.apk")

  @Suppress("DEPRECATION")
  private fun signatures(info: PackageInfo): Set<String> =
    (if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else info.signatures)
      ?.map { digest(it.toByteArray()) }?.toSet() ?: emptySet()

  @Suppress("DEPRECATION")
  private val signatureFlags get() = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
  @Suppress("DEPRECATION")
  fun installed(): PackageInfo = context.packageManager.getPackageInfo(context.packageName, signatureFlags)
  @Suppress("DEPRECATION")
  fun version(info: PackageInfo): Long = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
  fun supported() = context.packageName == "dev.caldone.app" && signatures(installed()) == setOf(UpdatePolicy.signer)

  fun validate(file: File, size: Long, sha256: String) {
    check(supported()) { "signature" }
    check(UpdatePolicy.matchesDownload(file, size, sha256)) { "integrity" }
    @Suppress("DEPRECATION")
    val candidate = context.packageManager.getPackageArchiveInfo(file.path, signatureFlags)
      ?: error("integrity")
    val abis = ZipFile(file).use { zip -> zip.entries().asSequence()
      .map { it.name }.filter { it.startsWith("lib/") && it.endsWith(".so") }
      .map { it.split('/')[1] }.toSet() }
    val failure = UpdatePolicy.validate(candidate.packageName, signatures(candidate), version(candidate),
      candidate.applicationInfo?.minSdkVersion ?: Int.MAX_VALUE, abis,
      version(installed()), Build.VERSION.SDK_INT, Build.SUPPORTED_ABIS.toSet())
    check(failure == null) { failure!! }
  }

  fun validateReady() = validate(apk, prefs.getLong("size", 0), prefs.getString("sha256", "")!!)
  fun status(value: String, error: String = "") {
    check(prefs.edit().putString("status", value).putString("error", error).commit()) { "storage" }
  }
  companion object {
    private fun hex(value: ByteArray) = value.joinToString("") { "%02x".format(it) }
    fun digest(value: ByteArray) = hex(MessageDigest.getInstance("SHA-256").digest(value))
  }
}
