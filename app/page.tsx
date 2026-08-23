export default function Home() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
      <h1 className="font-serif text-3xl text-t1">Your library is empty</h1>
      <p className="max-w-sm text-sm text-t2">
        Import tracks to start building your collection.
      </p>
    </div>
  );
}
