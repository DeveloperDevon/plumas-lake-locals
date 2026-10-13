export interface StagedFile {
  file: File;
  altText: string;
}

/**
 * NFR-09: the alt-text prompt for a multi-file picker - one row (filename + a plain text
 * input) per staged file, shown once files are picked and read when the real upload fires.
 * Shared because it's pure presentation with no per-feature logic, unlike this app's usual
 * "duplicate the small typed component" convention for things that actually differ by context.
 */
export function StagedPhotoAltTextList({
  files,
  onChange,
}: {
  files: StagedFile[];
  onChange: (next: StagedFile[]) => void;
}) {
  if (files.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {files.map((entry, index) => (
        <div key={`${entry.file.name}-${index.toString()}`} className="flex flex-col gap-1">
          <p className="truncate text-xs text-muted-foreground">{entry.file.name}</p>
          <input
            type="text"
            placeholder="Describe this image for screen readers (optional)"
            value={entry.altText}
            maxLength={300}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
            onChange={(event) => {
              const next = [...files];
              next[index] = { ...entry, altText: event.target.value };
              onChange(next);
            }}
          />
        </div>
      ))}
    </div>
  );
}
