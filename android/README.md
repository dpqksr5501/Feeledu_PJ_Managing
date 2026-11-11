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

권장 다운로드 주소는 https://feeledu-attendance.feeledu-pj-managing.workers.dev/downloads/feeledu-attendance.apk 입니다. 공개 GitHub APK를 CI가 무결성 검증 후 같은 Worker의 정적 파일로 포함합니다. 파일 크기·MIME·ETag·HTTP Range를 명시하고 서비스워커를 거치지 않습니다. GitHub Releases는 원본과 대체 다운로드 경로로 유지합니다.

`Android installation and icon checks`에서 공개 APK를 지정해 Android 6/10/16 에뮬레이터에 새 설치·업데이트·반복 설치하고 실제 PackageManager 아이콘을 렌더링합니다. 테스트 APK와 서명 비밀값은 릴리즈에 공개하지 않습니다. 네이티브 계층에서 원래 환경의 앱 아이콘과 APK 설치를 검사하며, Android 10/16에서는 DownloadManager가 공개 직접 다운로드를 완료하고 체크섬이 맞는지도 검사합니다. 테스트 APK는 설치된 원본과 동일한 인증서로 서명합니다. 태블릿 모델 필터는 없습니다.

APK 최소 OS는 Android 6이나, 최신 Chrome의 현재 OS 지원과 다릅니다. 운영은 Android 10 이상과 최신 Chrome을 권장합니다. Android 6의 테스트 통과는 기본 APK 설치·아이콘 범위이며 사용자 기기의 구형 Chrome으로 전체 웹 기능이 검증됐다는 뜻이 아닙니다.

GitHub Releases의 APK를 Chrome으로 내려받아 설치하고 실행합니다. Android가 요청하는 설치 출처 승인은 사용자가 직접 수행합니다. 서버의 assetlinks 인증서가 APK와 일치해야 주소창이 숨겨집니다. 기존 브라우저 연결·미전송 기록은 같은 Chrome 프로필에서 보존됩니다. 서비스워커를 사용하므로 최초 연결은 인터넷이 필요합니다.

기기 출퇴근은 기존 8자리 태블릿 연결·서버 시각·UUID 중복 방지·오프라인 검토 흐름을 그대로 사용합니다. Android APK 빌드 성공과 실물 태블릿 설치 성공은 별도로 확인합니다.
