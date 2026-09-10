package dev.caldone.updates

import java.io.File
import java.security.MessageDigest

object UpdatePolicy {
  // Same release identity verified by Android release CI. Key rotation requires
  // a deliberate migration; never trust a signer supplied by release metadata.
  // TODO(signing): migrate away from the public React Native template key.
  // Existing releases use it, so this pin preserves compatibility, not exclusive
  // publisher identity. Official GitHub origin and digest checks remain essential.
  const val signer = "fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c"
  fun matchesDownload(file: File, size: Long, sha256: String): Boolean {
    if (!file.isFile || file.length() != size) return false
    val hash = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
      val buffer = ByteArray(64 * 1024)
      while (true) { val n = input.read(buffer); if (n < 0) break; hash.update(buffer, 0, n) }
    }
    return hash.digest().joinToString("") { "%02x".format(it) } == sha256
  }
  fun validate(name: String, signers: Set<String>, version: Long, minSdk: Int, abis: Set<String>,
    installedVersion: Long, deviceSdk: Int, deviceAbis: Set<String>): String? = when {
    name != "dev.caldone.app" -> "package"
    signers != setOf(signer) -> "signature"
    version <= installedVersion -> "version"
    minSdk > deviceSdk || abis.intersect(deviceAbis).isEmpty() -> "incompatible"
    else -> null
  }
}
