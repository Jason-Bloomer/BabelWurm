// electron-builder afterPack hook.
// When the Windows build is made on Linux/macOS without Wine, electron-builder
// can't stamp the app's name, version and icon into the .exe (it needs rcedit),
// so Task Manager would show every process as "Electron". This hook does the
// same job with resedit (pure JavaScript). On Windows CI electron-builder does
// it itself and this hook does nothing.
import * as fs from "node:fs";
import * as path from "node:path";

export default async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;
  const cfgWin = context.packager.config.win || {};
  if (cfgWin.signAndEditExecutable !== false) return; // electron-builder handles it
  const { NtExecutable, NtExecutableResource, Resource, Data } = await import("resedit");
  const info = context.packager.appInfo;
  const exePath = path.join(context.appOutDir, `${info.productFilename}.exe`);
  const exe = NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = NtExecutableResource.from(exe);

  const iconFile = Data.IconFile.from(fs.readFileSync(path.join(context.packager.projectDir, "build", "icon.ico")));
  const groups = Resource.IconGroupEntry.fromEntries(res.entries);
  const groupId = groups[0]?.id ?? 1;
  const lang = groups[0]?.lang ?? 1033;
  Resource.IconGroupEntry.replaceIconsForResource(res.entries, groupId, lang, iconFile.icons.map((i) => i.data));

  const vi = Resource.VersionInfo.fromEntries(res.entries)[0] || Resource.VersionInfo.createEmpty();
  const [a, b, c] = info.version.split(".").map((n) => parseInt(n, 10) || 0);
  vi.setFileVersion(a, b, c, 0, 1033);
  vi.setProductVersion(a, b, c, 0, 1033);
  const langs = vi.getAllLanguagesForStringValues();
  const target = langs.length ? langs : [{ lang: 1033, codepage: 1200 }];
  for (const l of target) {
    vi.setStringValues(l, {
      FileDescription: info.productName,
      ProductName: info.productName,
      InternalName: info.productFilename,
      OriginalFilename: `${info.productFilename}.exe`,
      CompanyName: info.companyName || info.productName,
      LegalCopyright: info.copyright || "MIT License",
      FileVersion: info.version,
      ProductVersion: info.version,
    });
  }
  vi.outputToResourceEntries(res.entries);
  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log(`  • afterPack: set name/version/icon of ${path.basename(exePath)}`);
}
