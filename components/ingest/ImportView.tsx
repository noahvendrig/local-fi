"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSpotifyLoginUrl } from "@/lib/api/spotifyClient";
import { filterAudioFiles } from "@/lib/ingest/collectFiles";
import { useCommandPaletteStore } from "@/lib/store/commandPalette";
import { useIngestStore } from "@/lib/store/ingest";
import { JobFileRow } from "./JobFileRow";
import { LibraryFoldersSection } from "./LibraryFoldersSection";
import { MobileLocalImportSection } from "./MobileLocalImportSection";

const TERMINAL_JOB = new Set(["completed", "completed_with_errors", "failed", "cancelled"]);

export function ImportView() {
  const queryClient = useQueryClient();
  const openCommandPalette = useCommandPaletteStore((s) => s.open);
  const isDragActive = useIngestStore((s) => s.isDragActive);
  const dragItemCount = useIngestStore((s) => s.dragItemCount);
  const jobs = useIngestStore((s) => s.jobs);
  const error = useIngestStore((s) => s.error);
  const spotifyNotConnected = useIngestStore((s) => s.spotifyNotConnected);
  const loginUrl = useSpotifyLoginUrl();
  const submitFiles = useIngestStore((s) => s.submitFiles);
  const cancelJob = useIngestStore((s) => s.cancelJob);
  const importFromSpotify = useIngestStore((s) => s.importFromSpotify);
  const uploadProgress = useIngestStore((s) => s.uploadProgress);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [spotifyUrl, setSpotifyUrl] = useState("");
  const [isSubmittingSpotify, setIsSubmittingSpotify] = useState(false);

  useEffect(() => {
    void useIngestStore.getState().hydrateJobs();
  }, []);

  const terminalKey = jobs
    .filter((job) => TERMINAL_JOB.has(job.status))
    .map((job) => `${job.id}:${job.status}`)
    .join("|");

  useEffect(() => {
    if (!terminalKey) return;
    queryClient.invalidateQueries({ queryKey: ["tracks"] });
    queryClient.invalidateQueries({ queryKey: ["albums"] });
    queryClient.invalidateQueries({ queryKey: ["artists"] });
    queryClient.invalidateQueries({ queryKey: ["playlists"] });
    queryClient.invalidateQueries({ queryKey: ["library-roots"] });
  }, [terminalKey, queryClient]);

  const trayJobs = jobs.filter((job) => job.type !== "folder_scan");
  const files = trayJobs.flatMap((job) => job.files);
  const totalFiles = trayJobs.reduce((sum, job) => sum + job.totalFiles, 0);
  const processedFiles = trayJobs.reduce((sum, job) => sum + job.processedFiles, 0);
  const failedFiles = trayJobs.reduce((sum, job) => sum + job.failedFiles, 0);
  const activeJob = trayJobs.find((job) => job.status === "pending" || job.status === "running");
  const indexingJob = jobs.find((job) => job.type === "folder_scan" && (job.status === "pending" || job.status === "running"));
  const meta = uploadProgress
    ? `copying ${uploadProgress.copied} of ${uploadProgress.total}`
    : indexingJob
      ? `indexing ${indexingJob.processedFiles} of ${indexingJob.totalFiles}`
      : files.length > 0
        ? `${files.length} file${files.length === 1 ? "" : "s"} in tray`
        : "drop a folder to begin";

  function handleBrowse() {
    folderInputRef.current?.click();
  }

  function handleFolderChange(e: ChangeEvent<HTMLInputElement>) {
    const audio = filterAudioFiles(e.target.files ?? []);
    e.target.value = "";
    if (audio.length === 0) {
      useIngestStore.getState().setError("No supported audio files were in that folder.");
      return;
    }
    void submitFiles(audio);
  }

  async function handleSpotifySubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const url = spotifyUrl.trim();
    if (!url || isSubmittingSpotify) return;
    setIsSubmittingSpotify(true);
    try {
      await importFromSpotify(url);
      setSpotifyUrl("");
    } finally {
      setIsSubmittingSpotify(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-none items-center gap-4 px-10 pb-4 pt-[22px]">
        <h1 className="whitespace-nowrap text-[28px] font-bold leading-[1.2] text-t1">Import</h1>
        <span className="truncate pt-2 font-mono text-xs text-t3">{meta}</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={openCommandPalette}
          className="flex min-w-[190px] items-center gap-2.5 rounded-lg border border-line bg-surf px-3 py-2 text-[13px] text-t2 hover:border-acc hover:text-t1"
        >
          <SearchIcon />
          Search library
          <span className="ml-auto font-mono text-[11px] text-t3">⌘K</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-10 pb-8">
        <input
          ref={(node) => {
            folderInputRef.current = node;
            if (node) {
              node.setAttribute("webkitdirectory", "");
              node.setAttribute("directory", "");
            }
          }}
          type="file"
          multiple
          className="hidden"
          onChange={handleFolderChange}
        />

        <button
          type="button"
          onClick={handleBrowse}
          aria-label="Choose a folder to import"
          className={`w-full rounded-2xl px-12 py-12 text-center transition-[border-color,background-color,box-shadow] duration-150 ${
            isDragActive
              ? "border-[1.5px] border-solid border-acc bg-[var(--lf-tint)] shadow-[0_0_0_6px_var(--lf-ring)]"
              : "lf-top border-[1.5px] border-dashed border-line bg-surf hover:border-acc"
          }`}
        >
          <p className="font-serif text-[40px] font-medium leading-[1.1] text-t1">
            {isDragActive ? "Drop to import" : "Drag music here"}
          </p>
          <p className="mt-3 text-sm text-t2">
            {isDragActive
              ? dragItemCount > 0
                ? `${dragItemCount} item${dragItemCount === 1 ? "" : "s"} · release to begin`
                : "release to begin"
              : "or click to choose a folder — files are copied, originals untouched"}
          </p>
          <p className="mt-1.5 font-mono text-xs text-t3">FLAC · ALAC · MP3 · WAV · AIFF · OGG · OPUS · WEBM</p>
        </button>

        <form onSubmit={handleSpotifySubmit} className="mt-4 flex items-center gap-2.5">
          <input
            type="url"
            inputMode="url"
            value={spotifyUrl}
            onChange={(e) => setSpotifyUrl(e.target.value)}
            placeholder="Paste a link to one of your Spotify playlists…"
            className="flex-1 rounded-lg border border-line bg-surf px-3 py-2 text-sm text-t1 placeholder:text-t3 focus:border-acc focus:outline-none"
          />
          <button
            type="submit"
            disabled={!spotifyUrl.trim() || isSubmittingSpotify}
            className="whitespace-nowrap rounded-lg border border-line bg-surf px-3 py-2 text-[13px] text-t2 hover:border-acc hover:text-t1 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmittingSpotify ? "Finding tracks…" : "Import from Spotify"}
          </button>
        </form>

        {spotifyNotConnected ? (
          <p className="mt-4 flex flex-wrap items-center gap-2 text-sm text-err">
            Connect your Spotify account to import playlists.
            <a
              href={loginUrl}
              className="rounded-md border border-line bg-surf px-2.5 py-1 text-xs font-medium text-t1 hover:border-acc"
            >
              Connect Spotify
            </a>
          </p>
        ) : error ? (
          <p className="mt-4 text-sm text-err">{error}</p>
        ) : null}

        {files.length > 0 ? (
          <section className="mt-8">
            <div className="mb-3.5 flex items-center gap-2.5">
              <h2 className="text-xl font-semibold leading-[1.3] text-t1">Ingest tray</h2>
              <span className="font-mono text-xs text-t3">
                {processedFiles} of {totalFiles} processed
                {failedFiles > 0 ? ` · ${failedFiles} failed` : ""}
              </span>
              <div className="flex-1" />
              {activeJob ? (
                <button type="button" onClick={() => cancelJob(activeJob.id)} className="text-xs text-t3 hover:text-err">
                  Cancel
                </button>
              ) : null}
            </div>
            <ul className="flex flex-col gap-2">
              {files.map((file) => (
                <JobFileRow key={file.id} file={file} />
              ))}
            </ul>
          </section>
        ) : null}

        {/* Watched-folder syncing is a desktop-only feature (server filesystem paths); not part of the mobile design. */}
        <div className="hidden md:block">
          <LibraryFoldersSection />
        </div>

        <MobileLocalImportSection />
      </div>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}
