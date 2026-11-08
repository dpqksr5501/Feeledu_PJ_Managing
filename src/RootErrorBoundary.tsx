import { Component, type ReactNode } from "react";
export class RootErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    console.error("화면 오류:", error);
  }
  render() {
    if (this.state.failed)
      return (
        <main className="fatal">
          <h1>화면을 다시 열어 주세요.</h1>
          <p className="muted">
            기기와 서버에 저장된 기록은 유지됩니다. 문제가 계속되면 관리자에게
            알려 주세요.
          </p>
          <button className="button primary" onClick={() => location.reload()}>
            다시 열기
          </button>
        </main>
      );
    return this.props.children;
  }
}
