#!/usr/bin/env bash
set -euo pipefail
mkdir -p android-smoke
adb wait-for-device
trap 'adb logcat -d > android-smoke/logcat.txt; adb shell dumpsys activity activities > android-smoke/launch-activities.txt' EXIT
adb shell getprop ro.build.version.release | tee android-smoke/android-version.txt
timeout 120 adb install --no-streaming release/feeledu-attendance.apk | tee android-smoke/install-candidate-clean.txt
grep -q Success android-smoke/install-candidate-clean.txt
adb logcat -c
timeout 30 adb shell am start -n kr.feeledu.attendance/com.google.androidbrowserhelper.trusted.LauncherActivity > android-smoke/launch-clean.txt
sleep 5
adb logcat -d > android-smoke/launch-clean-logcat.txt
if grep -E 'Process: kr.feeledu.attendance,|Unable to start activity ComponentInfo\{kr.feeledu.attendance' android-smoke/launch-clean-logcat.txt; then exit 1; fi
# Only this disposable CI emulator is reset to test the old-to-new upgrade path.
adb uninstall kr.feeledu.attendance
# The emulator is disposable. Install the first public version, then upgrade without uninstalling.
timeout 120 adb install --no-streaming baseline/feeledu-attendance.apk | tee android-smoke/install-baseline.txt
grep -q Success android-smoke/install-baseline.txt
adb shell pm list packages > android-smoke/browser-packages.txt
# The baseline's launcher is known to crash. Its installation is sufficient for an upgrade test.
timeout 120 adb install --no-streaming -r release/feeledu-attendance.apk | tee android-smoke/install-upgrade.txt
grep -q Success android-smoke/install-upgrade.txt
timeout 120 adb install --no-streaming -r release/feeledu-attendance.apk | tee android-smoke/install-repeat.txt
grep -q Success android-smoke/install-repeat.txt
adb shell pm path kr.feeledu.attendance | tee android-smoke/package-path.txt
timeout 120 adb install --no-streaming -r -t android/app/build/outputs/apk/androidTest/release/app-release-androidTest.apk
timeout 120 adb shell am instrument -w kr.feeledu.attendance.test/kr.feeledu.attendance.IconSmokeTest | tee android-smoke/icon-render.txt
grep -q 'feeledu_status=PASS' android-smoke/icon-render.txt
api_level=$(adb shell getprop ro.build.version.sdk | tr -d '\r')
adb pull "/sdcard/Android/data/kr.feeledu.attendance/files/launcher-icon-api-$api_level.png" android-smoke/launcher-icon.png
adb shell dumpsys package kr.feeledu.attendance > android-smoke/package-info.txt
adb logcat -c
timeout 240 node scripts/android-launch-check.mjs
adb logcat -d > android-smoke/logcat.txt
if grep -E 'Process: kr.feeledu.attendance,|Unable to start activity ComponentInfo\{kr.feeledu.attendance|kr.feeledu.attendance keeps stopping' android-smoke/logcat.txt; then
  echo 'Actual launcher execution failed.'
  exit 1
fi
echo 'Install, upgrade, icon, actual kiosk launch, repeat launch and missing-browser recovery passed (legacy API 23: native recovery only).'
