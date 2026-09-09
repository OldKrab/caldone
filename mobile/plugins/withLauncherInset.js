const { withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');

// Keep the generated mark inside Android's adaptive-icon safe region.
// Apply layout insets to the drawable rather than altering the source artwork.
module.exports = function withLauncherInset(config) {
  return withDangerousMod(config, ['android', async (mod) => {
    const resources = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/res');
    for (const directory of await fs.readdir(resources)) {
      if (!directory.startsWith('mipmap-anydpi')) continue;
      for (const filename of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
        const target = path.join(resources, directory, filename);
        let xml;
        try { xml = await fs.readFile(target, 'utf8'); }
        catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        const updated = xml.replace(/<foreground\s+android:drawable="@mipmap\/ic_launcher_foreground"\s*\/>/, '<foreground><inset android:insetLeft="12%" android:insetTop="12%" android:insetRight="12%" android:insetBottom="12%"><bitmap android:src="@mipmap/ic_launcher_foreground" android:gravity="fill" /></inset></foreground>');
        await fs.writeFile(target, updated);
      }
    }
    return mod;
  }]);
};
