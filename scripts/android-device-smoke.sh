#!/usr/bin/env bash
set -euo pipefail
mkdir -p android-smoke
adb wait-for-device
adb shell getprop ro.build.version.release | tee android-smoke/android-version.txt
# The emulator is disposable. Install the first public version, then upgrade without uninstalling.
timeout 120 adb install --no-streaming baseline/feeledu-attendance.apk | tee android-smoke/install-baseline.txt
grep -q Success android-smoke/install-baseline.txt
adb shell pm list packages > android-smoke/browser-packages.txt
adb logcat -c
adb shell am start -W -n kr.feeledu.attendance/com.google.androidbrowserhelper.trusted.LauncherActivity > android-smoke/launch-baseline.txt
sleep 5
adb logcat -d > android-smoke/launch-baseline-logcat.txt
adb shell am force-stop kr.feeledu.attendance
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
adb shell am start -W -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n kr.feeledu.attendance/com.google.androidbrowserhelper.trusted.LauncherActivity | tee android-smoke/launch-candidate.txt
sleep 8
adb shell dumpsys activity activities > android-smoke/launch-activities.txt
adb shell uiautomator dump /sdcard/launch.xml
adb pull /sdcard/launch.xml android-smoke/launch.xml
adb shell screencap -p /sdcard/launch.png
adb pull /sdcard/launch.png android-smoke/launch.png
adb logcat -d -t 500 > android-smoke/logcat.txt
if grep -E 'FATAL EXCEPTION|Unable to start activity|Process: kr.feeledu.attendance,' android-smoke/logcat.txt; then
  echo 'Actual launcher execution failed.'
  exit 1
fi
echo 'Clean install, upgrade, repeated install and actual Android launcher icon rendering passed.'
