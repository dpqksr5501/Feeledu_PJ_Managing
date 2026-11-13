export type ReleaseNote = {
  id: string;
  date: string;
  title: string;
  changes: string[];
};
export type AppRelease = {
  revision: string;
  releaseId: string;
  releases: ReleaseNote[];
};

// Newest first. Keep IDs stable so skipped versions can be acknowledged together.
export const appReleases: ReleaseNote[] = [
  {
    id: "2026-11-14.1",
    date: "2026-11-14",
    title: "관리자 로그인 유지",
    changes: [
      "관리자 화면의 미사용·백그라운드·12시간 자동 잠금을 해제했습니다.",
      "로그인은 7일 동안 유지되며 사용 중 자동으로 연장됩니다.",
      "직접 로그아웃하거나 계정을 해제하면 접속을 종료합니다.",
    ],
  },
  {
    id: "2026-11-13.3",
    date: "2026-11-13",
    title: "야간 근무·월 시급",
    changes: [
      "자정을 넘는 근무와 누락 기록을 날짜·시간으로 직접 입력할 수 있습니다.",
      "월 시급과 하루 시급을 나누고, 같은 달 변경 충돌을 확인합니다.",
      "메모만 정정할 때 원래 기록의 초 단위 시각을 유지합니다.",
      "출퇴근 화면은 계속 유지하며, 관리자의 2분 미사용 잠금을 제거했습니다.",
    ],
  },
  {
    id: "2026-11-13.2",
    date: "2026-11-13",
    title: "업데이트 안내·조회 개선",
    changes: [
      "업데이트 전에 안내하고, 적용 후 변경 내역을 확인할 수 있습니다.",
      "여러 업데이트를 한 목록에 모아 스크롤로 볼 수 있습니다.",
      "관리자 화면의 중복 조회와 불필요한 자료 요청을 줄였습니다.",
    ],
  },
  {
    id: "2026-11-13.1",
    date: "2026-11-13",
    title: "한국 공휴일 자동 반영",
    changes: [
      "공식 자료에 등록된 공휴일·대체·임시공휴일을 자동 반영합니다.",
      "공휴일 변경 검토와 갱신 상태를 설정에서 확인할 수 있습니다.",
      "연결 오류가 나도 기존 휴일과 확정 정산본은 유지됩니다.",
    ],
  },
  {
    id: "2026-11-12.1",
    date: "2026-11-12",
    title: "출퇴근 안정성·백업",
    changes: [
      "동시 입력과 통신 재시도 때 중복 기록을 방지합니다.",
      "근무·급여 조회를 개선하고, 백업 파일 검사 기능을 추가했습니다.",
    ],
  },
];

export function parseAppRelease(value: unknown): AppRelease | null {
  if (!value || typeof value !== "object") return null;
  const info = value as AppRelease;
  if (
    typeof info.revision !== "string" ||
    !/^[a-f0-9]{16}$/.test(info.revision) ||
    typeof info.releaseId !== "string" ||
    !Array.isArray(info.releases) ||
    !info.releases.length ||
    info.releases.length > 30
  )
    return null;
  const ids = new Set<string>();
  for (const note of info.releases) {
    if (
      !note ||
      typeof note.id !== "string" ||
      note.id.length > 60 ||
      ids.has(note.id) ||
      typeof note.title !== "string" ||
      note.title.length > 100 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(note.date) ||
      !Array.isArray(note.changes) ||
      !note.changes.length ||
      note.changes.length > 20 ||
      note.changes.some((item) => typeof item !== "string" || item.length > 300)
    )
      return null;
    ids.add(note.id);
  }
  return ids.has(info.releaseId) ? info : null;
}

export function releaseNotesSince(info: AppRelease, priorId?: string) {
  const current = info.releases.findIndex((note) => note.id === info.releaseId);
  const previous = info.releases.findIndex((note) => note.id === priorId);
  if (previous >= 0 && previous <= current) return [];
  return info.releases.slice(current, previous >= 0 ? previous : undefined);
}
