package dev.caldone.updates

import org.junit.Assert.*
import org.junit.Test
import java.io.File

class UpdatePolicyTest {
  @Test fun incompleteAndCorruptedBytesNeverBecomeInstallable() {
    val file = File.createTempFile("caldone-update", ".apk")
    try {
      file.writeText("hello")
      val digest = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
      assertTrue(UpdatePolicy.matchesDownload(file, 5, digest))
      assertFalse(UpdatePolicy.matchesDownload(file, 6, digest))
      file.writeText("jello")
      assertFalse(UpdatePolicy.matchesDownload(file, 5, digest))
    } finally { file.delete() }
  }
  @Test fun onlyNewerCompatibleOfficialPackagesAreAccepted() {
    fun check(name: String = "dev.caldone.app", signer: String = UpdatePolicy.signer,
      version: Long = 14, sdk: Int = 28, abis: Set<String> = setOf("arm64-v8a")) =
      UpdatePolicy.validate(name, setOf(signer), version, sdk, abis, 13, 35, setOf("arm64-v8a"))
    assertNull(check())
    assertEquals("package", check(name = "other.app"))
    assertEquals("signature", check(signer = "untrusted"))
    assertEquals("version", check(version = 13))
    assertEquals("version", check(version = 12))
    assertEquals("incompatible", check(sdk = 36))
    assertEquals("incompatible", check(abis = setOf("x86_64")))
  }
}
