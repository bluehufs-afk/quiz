# 사내 퀴즈 챌린지 — Firebase 배포 안내

## 구성
- 9개 팀, 각 팀 대표자 1명 로그인
- 경지·인력·노경·안전·환경·WCD, 분야별 상중하 18문제
- 60초 제한, 주관식 제출 및 수정, 정답 공개, 수동 점수 확정, 실시간 순위, CSV 저장
- 1회 행사 전용, Firebase Hosting + Authentication + Firestore 사용

## 설치·배포 (PC에서 진행 권장)
1. https://console.firebase.google.com 에서 새 프로젝트 생성.
2. Authentication > Sign-in method > 이메일/비밀번호 활성화.
3. Authentication > Users에서 사회자 1명과 팀 대표자 9명 계정 생성. 각각의 이메일/비밀번호를 전달. 사회자 UID 복사.
4. Firestore Database 생성 (프로덕션 모드). 리전은 한국과 가까운 곳으로 선택.
5. 프로젝트 설정 > 내 앱 > 웹 앱 등록 후 Firebase 설정값 복사.
6. `config.example.js`를 `config.js`로 복사하고 Firebase 설정값과 사회자 UID 입력.
7. `firestore.rules`의 `REPLACE_WITH_ADMIN_UID`를 같은 사회자 UID로 변경.
8. Node.js 및 Firebase CLI 설치: `npm install -g firebase-tools`.
9. 이 폴더에서 `firebase login`, `firebase use --add`(프로젝트 선택), `firebase deploy --only hosting,firestore:rules` 실행.
10. 배포된 Hosting 주소에서 사회자 로그인 후 '9개 팀 설정'에 각 팀 UID와 이름 입력. 팀 UID는 Firebase 콘솔 Authentication > Users에서도 복사 가능.
11. '18문제 편집'에서 문제/정답/유사 정답/배점을 입력. 사회자와 팀 휴대폰에서 접속 테스트.

## 주의 사항
- `config.js`에는 Firebase 웹앱 공개 설정만 들어갑니다. 서비스 계정 비밀키는 절대 넣지 마세요.
- 팀 계정은 사전에 Firebase Authentication에서 생성해야 합니다. 앱 내 가입 기능은 없습니다.
- Firebase 보안 규칙은 팀이 정답을 사전에 읽지 못하도록 비공개 문제 문서를 제한합니다.
- 타이머와 제출 마감은 Firestore 서버 시간 기준으로 검사합니다. 다만 사회자 브라우저가 연결된 상태에서 60초 만료를 감지해 정답 공개로 전환하므로 사회자 PC의 인터넷 연결을 유지하세요.
- 팀 답안 공개는 종료 후 전체 공개가 기본입니다. 별도 비공개 설정 UI는 아직 없습니다.
- Firebase 무료 사용량은 정책과 트래픽에 따라 달라지므로 콘솔에서 확인하세요.
- 행사 전에 최소 2대 이상의 서로 다른 기기에서 로그인·마감·채점·CSV 저장을 시험하세요.
- 이 파일은 소스 패키지입니다. Firebase 계정 연결과 실제 배포는 아직 이루어지지 않았습니다.
