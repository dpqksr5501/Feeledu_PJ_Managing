# 안드로이드 설치 파일

Google Android Browser Helper의 Trusted Web Activity로 기존 Cloudflare 앱을 실행합니다. Chrome의 검증된 브라우저 엔진·IndexedDB·서비스워커를 공유하며 주소창 없는 앱 화면을 제공합니다. 별도 출퇴근 DB나 급여 산식을 Android에 복제하지 않습니다.

패키지명 `kr.feeledu.attendance`, 서버 주소, `.well-known/assetlinks.json`의 인증서와 영구 서명 키를 유지해야 기존 앱 위에 업데이트할 수 있습니다. 웹 화면·계산 기능은 기존 서버를 배포해 반영합니다. Android 패키지 자체가 바뀔 때만 새 APK를 설치합니다.

## 빌드·릴리즈

- GitHub Actions의 **Build and publish Android APK**는 `main`의 Android 변경을 빌드·검사하고 서명된 APK를 artifact로 보관합니다.
- `android/version.properties`의 versionCode와 versionName을 올리고 일치하는 `android-v1.0.0` 형식의 태그를 푸시하면 웹 테스트·Android lint·APK 서명 검사를 통과한 뒤 GitHub Releases에 `feeledu-attendance.apk`, SHA256SUMS, 서명 정보를 공개합니다.
- APK 다운로드 고정 주소: https://github.com/dpqksr5501/Feeledu_PJ_Managing/releases/latest/download/feeledu-attendance.apk
- 같은 버전의 APK를 덮어쓰지 않습니다. 문제를 수정했으면 버전·versionCode를 올려 새 릴리즈를 만듭니다.
- CI는 저장소 Secrets `ANDROID_SIGNING_KEY`(PKCS12의 base64), `ANDROID_SIGNING_PASSWORD`를 사용합니다. private key·비밀번호는 Git/릴리즈에 포함하지 않습니다. 키 별칭은 `feeledu`입니다.
- 최초 키는 `scripts/android-signing-init.mjs`로 생성했습니다. `.secrets/android-signing/`은 Git에서 제외된 로컬 보관본입니다. 이 폴더를 안전하게 백업하고 기존 키를 다시 생성하지 마세요.

## 로컬 빌드

JDK 17, Gradle 8.13, Android SDK 36이 있는 환경에서 `gradle -p android lintRelease assembleRelease`를 실행합니다. 배포 빌드는 `ANDROID_SIGNING_STORE_FILE`과 `ANDROID_SIGNING_PASSWORD` 환경 변수가 필요합니다. 비밀값은 명령행이나 소스에 쓰지 않습니다.

## 설치·검증

GitHub Releases의 APK를 Chrome으로 내려받아 설치하고 실행합니다. Android가 요청하는 설치 출처 승인은 사용자가 직접 수행합니다. 서버의 assetlinks 인증서가 APK와 일치해야 주소창이 숨겨집니다. 기존 브라우저 연결·미전송 기록은 같은 Chrome 프로필에서 보존됩니다. 서비스워커를 사용하므로 최초 연결은 인터넷이 필요합니다.

기기 출퇴근은 기존 8자리 태블릿 연결·서버 시각·UUID 중복 방지·오프라인 검토 흐름을 그대로 사용합니다. Android APK 빌드 성공과 실물 태블릿 설치 성공은 별도로 확인합니다.
