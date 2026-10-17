import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 sm:p-24">
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-4xl">
          NextCall Prospector
        </h1>
        <p className="max-w-prose text-lg text-gray-500 dark:text-gray-400">
          Internal Lead Generation & Business Intelligence Dashboard
        </p>
        <div className="mt-8 flex gap-4">
          <Link
            href="/dashboard"
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700 dark:bg-white dark:text-black dark:hover:bg-gray-200"
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}