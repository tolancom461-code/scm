import { useRef, useState } from "react";
import type { Locale } from "@/lib/i18n";
import "./project-attachment-upload.css";

type AttachmentTarget = {
  entityType: "pm_project" | "pm_task";
  entityId: number;
};
type UploadJob = { id: number; file: File; target: AttachmentTarget };
type UploadFailure = { id: number; file: File; error: string };
type FailedJob = UploadFailure & { target: AttachmentTarget };
type UploadProgress = { completed: number; total: number };
type UploadResult = { uploaded: number; failed: number };

const copy = {
  ar: {
    uploading: "جارٍ رفع المرفقات…",
    progress: (completed: number, total: number) =>
      `تمت معالجة ${completed} من ${total} مرفق.`,
    retry: "إعادة رفع",
    failed: "تعذّر رفع بعض المرفقات.",
    network: "تعذّر الاتصال بالخادم أثناء الرفع.",
    invalidResponse: "تعذّر تأكيد الرفع من رد الخادم.",
    tooLarge: "يتجاوز الملف الحد الذي يقبله الخادم.",
    httpError: "تعذّر رفع المرفق.",
  },
  en: {
    uploading: "Uploading attachments…",
    progress: (completed: number, total: number) =>
      `Processed ${completed} of ${total} attachments.`,
    retry: "Retry upload",
    failed: "Some attachments could not be uploaded.",
    network: "Could not reach the server during upload.",
    invalidResponse: "The server response could not confirm the upload.",
    tooLarge: "The file exceeds the size accepted by the server.",
    httpError: "Could not upload the attachment.",
  },
  ur: {
    uploading: "منسلکات اپ لوڈ ہو رہے ہیں…",
    progress: (completed: number, total: number) =>
      `${total} میں سے ${completed} منسلکات کی کارروائی مکمل ہوئی۔`,
    retry: "دوبارہ اپ لوڈ کریں",
    failed: "کچھ منسلکات اپ لوڈ نہیں ہو سکے۔",
    network: "اپ لوڈ کے دوران سرور سے رابطہ نہیں ہو سکا۔",
    invalidResponse: "سرور کے جواب سے اپ لوڈ کی تصدیق نہیں ہو سکی۔",
    tooLarge: "فائل کا سائز سرور کی حد سے زیادہ ہے۔",
    httpError: "منسلکہ اپ لوڈ نہیں ہو سکا۔",
  },
};

async function uploadFile(
  { target, file }: UploadJob,
  locale: Locale
): Promise<string | null> {
  const message = copy[locale];
  let response: Response;
  try {
    response = await fetch(
      `/api/project-attachments/${target.entityType}/${target.entityId}`,
      {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-File-Name": encodeURIComponent(file.name),
        },
        body: file,
      }
    );
  } catch {
    return message.network;
  }
  const payload: unknown = await response.json().catch(() => null);
  const data =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  if (!response.ok) {
    if (typeof data?.message === "string" && data.message.trim())
      return data.message.trim();
    return response.status === 413
      ? message.tooLarge
      : `${message.httpError} (${response.status})`;
  }
  if (
    typeof data?.id !== "number" ||
    !Number.isSafeInteger(data.id) ||
    data.id < 1 ||
    typeof data.url !== "string" ||
    !data.url.trim()
  )
    return message.invalidResponse;
  return null;
}

export function useProjectAttachmentUpload(locale: Locale) {
  const locked = useRef(false);
  const nextId = useRef(0);
  const failedJobs = useRef(new Map<number, FailedJob>());
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [failures, setFailures] = useState<UploadFailure[]>([]);

  async function run(jobs: UploadJob[]): Promise<UploadResult | null> {
    if (locked.current || jobs.length === 0) return null;
    locked.current = true;
    setRunning(true);
    setProgress({ completed: 0, total: jobs.length });
    let completed = 0;
    let uploaded = 0;
    try {
      for (const job of jobs) {
        const error = await uploadFile(job, locale);
        if (error === null) {
          failedJobs.current.delete(job.id);
          uploaded++;
        } else {
          failedJobs.current.set(job.id, { ...job, error });
        }
        setFailures(
          Array.from(failedJobs.current.values(), ({ id, file, error }) => ({
            id,
            file,
            error,
          }))
        );
        completed++;
        setProgress({ completed, total: jobs.length });
      }
      return { uploaded, failed: failedJobs.current.size };
    } finally {
      locked.current = false;
      setRunning(false);
    }
  }

  function upload(target: AttachmentTarget, files: File[]) {
    return run(files.map(file => ({ id: ++nextId.current, file, target })));
  }
  function retry(id: number) {
    const job = failedJobs.current.get(id);
    return run(job ? [job] : []);
  }

  return { running, progress, failures, upload, retry };
}

export function ProjectAttachmentUploadStatus({
  locale,
  state,
  onRetry,
  retryDisabled = false,
}: {
  locale: Locale;
  state: ReturnType<typeof useProjectAttachmentUpload>;
  onRetry?: (id: number) => void;
  retryDisabled?: boolean;
}) {
  const text = copy[locale];
  const { running, progress, failures } = state;
  if (!progress && !failures.length) return null;
  const summary = progress
    ? text.progress(progress.completed, progress.total)
    : "";
  return (
    <section className="pm-attachment-upload-status">
      {progress && (
        <div className="pm-attachment-upload-progress">
          <span role="status">
            {running ? text.uploading + " " + summary : summary}
          </span>
          <progress
            aria-label={summary}
            value={progress.completed}
            max={progress.total}
          />
        </div>
      )}
      {failures.length > 0 && (
        <div>
          <p role="status">{text.failed}</p>
          <ul className="pm-attachment-upload-failures">
            {failures.map(failure => (
              <li key={failure.id}>
                <div>
                  <strong>
                    <bdi>{failure.file.name}</bdi>
                  </strong>
                  <span>{failure.error}</span>
                </div>
                <button
                  type="button"
                  aria-label={`${text.retry} ${failure.file.name}`}
                  disabled={running || retryDisabled}
                  onClick={() => {
                    if (onRetry) onRetry(failure.id);
                    else void state.retry(failure.id);
                  }}
                >
                  {text.retry}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
