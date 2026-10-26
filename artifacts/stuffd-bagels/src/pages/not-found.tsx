import { Link } from "wouter";

export default function NotFound() {
  return (
    <main className="min-h-screen w-full flex items-center justify-center bg-paper text-ink px-5">
      <div className="max-w-md w-full border-2 border-ink text-center">
        <p
          className="border-b-2 border-ink py-2.5 font-black text-xs tracking-widest uppercase"
          style={{ background: "var(--sb-highlight)" }}
        >
          Error 404
        </p>
        <div className="px-6 py-10">
          <h1
            className="leading-none tracking-tight m-0"
            style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "clamp(2.5rem,10vw,4rem)" }}
          >
            Not on the menu
          </h1>
          <p className="mt-4 text-sm font-medium text-ink/70">
            This page doesn't exist. The bagels are this way.
          </p>
          <Link
            href="/"
            className="inline-block mt-8 border-2 border-ink px-6 py-3 font-black text-sm tracking-widest uppercase hover:bg-ink hover:text-paper transition-colors"
          >
            Back to the menu
          </Link>
        </div>
      </div>
    </main>
  );
}
