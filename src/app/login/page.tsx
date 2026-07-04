import type { Metadata } from "next";
import { ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import { signInWithGoogle } from "../auth-actions.js";

export const metadata: Metadata = {
  title: "登录 · AI Signal",
};

// NextAuth routes failures back to this page (pages.error = "/login") with an
// `error` code; surface it inline rather than as a browser alert.
const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied: "这个 Google 账号不在允许名单内。请用已授权的邮箱登录，或联系管理员开通。",
  Configuration: "登录服务暂时不可用（服务端配置缺失）。请稍后重试或联系管理员。",
  Verification: "登录链接已失效，请重新发起登录。",
  default: "登录没有成功，请重试。",
};

// Keep only the path + query of the requested target and discard any origin, so
// a crafted ?callbackUrl=http://evil.com can never redirect off-site (open-redirect
// defence) while genuine deep links like /library are still honoured.
function toSafePath(raw: string | undefined): string {
  if (!raw) return "/";
  try {
    const url = new URL(raw, "http://placeholder.local");
    const path = url.pathname + url.search;
    return path.startsWith("/") ? path : "/";
  } catch {
    return "/";
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const callbackUrl = toSafePath(sp.callbackUrl);
  const errorMessage = sp.error ? ERROR_MESSAGES[sp.error] ?? ERROR_MESSAGES.default : null;
  const signInAction = signInWithGoogle.bind(null, callbackUrl);

  return (
    <main className="auth">
      <div className="auth__ambient" aria-hidden="true" />

      <section className="auth__panel">
        <div className="auth__brand">
          <span className="auth__mark" aria-hidden="true">
            S
          </span>
          <span className="auth__wordmark">
            <span className="auth__name">AI Signal</span>
            <span className="auth__kicker">信号流 · 个人情报台</span>
          </span>
        </div>

        <div className="auth__heading">
          <h1 className="auth__title">登录以进入你的信号流</h1>
          <p className="auth__lede">
            只对授权账号开放。用你的 Google 账号继续，进入个人化的 AI 资讯聚合与排序。
          </p>
        </div>

        {errorMessage ? (
          <div className="auth__alert" role="alert">
            {errorMessage}
          </div>
        ) : null}

        <form className="auth__form" action={signInAction}>
          <button type="submit" className="auth__google">
            <svg
              className="auth__g"
              width="19"
              height="19"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                fill="#4285F4"
                d="M23.52 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.87z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.96-1.08 7.95-2.91l-3.88-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.26v3.09A12 12 0 0 0 12 24z"
              />
              <path
                fill="#FBBC05"
                d="M5.27 14.29c-.24-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.26A12 12 0 0 0 0 12c0 1.94.46 3.77 1.26 5.38l4.01-3.09z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.26 6.62l4.01 3.1C6.22 6.86 8.87 4.75 12 4.75z"
              />
            </svg>
            使用 Google 账号登录
          </button>
        </form>

        <p className="auth__fineprint">
          <ShieldCheck size={15} weight="fill" aria-hidden="true" />
          仅限白名单内的 Google 邮箱访问
        </p>
      </section>
    </main>
  );
}
