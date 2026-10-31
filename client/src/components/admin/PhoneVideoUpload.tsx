import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  FileVideo,
  Images,
  LoaderCircle,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";
import {
  MAX_PHONE_VIDEO_BYTES,
  MAX_PHONE_VIDEO_SECONDS,
  PHONE_VIDEO_ACCEPT,
  getPhoneVideoContentType,
  isPhoneVideoStatusActive,
} from "@shared/phoneVideo";
import type { VideoJobInfo, VideoJobStatus } from "@shared/phoneVideo";
import { trpc } from "@/lib/trpc";
import "./PhoneVideoUpload.css";

type RetryKind = "prepare" | "transfer" | "finish" | null;

type PhoneVideoUploadProps = {
  lessonId: string;
  revision: number;
  videoJobId?: string;
  canStart: boolean;
  onActiveChange: (isActive: boolean) => void;
  onJobStarted: () => Promise<void> | void;
  onCompleted: (job: VideoJobInfo) => Promise<void> | void;
};

const statusLabels: Record<VideoJobStatus, string> = {
  uploading: "Téléversement en cours",
  queued: "En attente de conversion",
  processing: "Conversion en cours",
  ready: "Vidéo prête",
  failed: "Conversion échouée",
  cancelled: "Téléversement annulé",
};

class UploadAbortedError extends Error {
  constructor() {
    super("Le téléversement a été interrompu.");
    this.name = "UploadAbortedError";
  }
}

function isActiveJob(status: VideoJobStatus | undefined) {
  return status ? isPhoneVideoStatusActive(status) : false;
}

function friendlyError(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function formatBytes(bytes: number) {
  return `${Math.round(bytes / 1024 / 1024)} Mio`;
}

function getFileDuration(file: File): Promise<number | null> {
  return new Promise(resolve => {
    const video = document.createElement("video");
    const objectUrl = URL.createObjectURL(file);
    let completed = false;
    const finish = (duration: number | null) => {
      if (completed) return;
      completed = true;
      clearTimeout(timeout);
      video.onloadedmetadata = null;
      video.onerror = null;
      URL.revokeObjectURL(objectUrl);
      video.removeAttribute("src");
      video.load();
      resolve(duration);
    };
    const timeout = setTimeout(() => finish(null), 10_000);

    video.preload = "metadata";
    video.onloadedmetadata = () =>
      finish(Number.isFinite(video.duration) ? video.duration : null);
    video.onerror = () => finish(null);
    video.src = objectUrl;
  });
}

function createPutRequest(
  uploadUrl: string,
  file: File,
  contentType: string,
  onProgress: (progress: number) => void
) {
  const request = new XMLHttpRequest();
  const promise = new Promise<void>((resolve, reject) => {
    request.open("PUT", uploadUrl);
    request.setRequestHeader("Content-Type", contentType);
    request.upload.onprogress = event => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    request.onerror = () =>
      reject(new Error("Le téléversement vers le stockage a échoué."));
    request.onabort = () => reject(new UploadAbortedError());
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve();
        return;
      }
      reject(new Error("Le stockage a refusé le téléversement."));
    };
    request.send(file);
  });

  return { request, promise };
}

/**
 * Uploads original phone videos without ever putting the source URL in the lesson form.
 * The output URL, poster and duration are attached exclusively by the durable server job.
 */
export default function PhoneVideoUpload({
  lessonId,
  revision,
  videoJobId,
  canStart,
  onActiveChange,
  onJobStarted,
  onCompleted,
}: PhoneVideoUploadProps) {
  const utils = trpc.useUtils();
  const prepare = trpc.video.prepare.useMutation();
  const finish = trpc.video.finish.useMutation();
  const retry = trpc.video.retry.useMutation();
  const cancel = trpc.video.cancel.useMutation();
  const [jobId, setJobId] = useState<string | null>(videoJobId ?? null);
  const [job, setJob] = useState<VideoJobInfo | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [isStarting, setIsStarting] = useState(false);
  const [retryKind, setRetryKind] = useState<RetryKind>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isReconcilingReady, setIsReconcilingReady] = useState(false);
  const [readyRefreshFailed, setReadyRefreshFailed] = useState(false);
  const [readyRefreshAttempt, setReadyRefreshAttempt] = useState(0);
  const photosInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<XMLHttpRequest | null>(null);
  const cancelledJobRef = useRef<string | null>(null);
  const notifiedReadyJobRef = useRef<string | null>(null);
  const attemptedReadyRefreshRef = useRef<string | null>(null);
  const currentLessonRef = useRef(lessonId);
  const currentStatus = job?.status;
  const isJobActive =
    isStarting ||
    Boolean(jobId && (!currentStatus || isActiveJob(currentStatus)));
  const isReadyAwaitingReconciliation =
    job?.status === "ready" && notifiedReadyJobRef.current !== job.id;
  const isInteractionLocked =
    isJobActive ||
    isCancelling ||
    isReconcilingReady ||
    isReadyAwaitingReconciliation;

  const jobQuery = trpc.video.get.useQuery(
    { id: jobId ?? "" },
    {
      enabled: Boolean(jobId),
      refetchOnWindowFocus: true,
      refetchInterval: isJobActive ? 3_000 : false,
    }
  );

  const isBusy = isInteractionLocked;

  useEffect(() => {
    if (currentLessonRef.current === lessonId) return;
    currentLessonRef.current = lessonId;
    setJobId(videoJobId ?? null);
    setJob(null);
    setFile(null);
    setProgress(0);
    setRetryKind(null);
    setMessage(null);
    setIsReconcilingReady(false);
    setReadyRefreshFailed(false);
    setReadyRefreshAttempt(0);
    notifiedReadyJobRef.current = null;
    attemptedReadyRefreshRef.current = null;
  }, [lessonId, videoJobId]);

  useEffect(() => {
    if (videoJobId && videoJobId !== jobId) {
      setJobId(videoJobId);
      setJob(null);
      setProgress(0);
      setRetryKind(null);
      setMessage(null);
    }
  }, [jobId, videoJobId]);

  useEffect(() => {
    if (jobQuery.data?.id !== jobId) return;
    setJob(jobQuery.data);
    if (jobQuery.data.status !== "uploading") {
      setRetryKind(null);
    }
  }, [jobId, jobQuery.data]);

  useEffect(() => {
    onActiveChange(isInteractionLocked);
  }, [isInteractionLocked, onActiveChange]);

  useEffect(() => {
    if (job?.status !== "ready" || notifiedReadyJobRef.current === job.id)
      return;

    const attemptKey = `${job.id}:${readyRefreshAttempt}`;
    if (attemptedReadyRefreshRef.current === attemptKey) return;
    attemptedReadyRefreshRef.current = attemptKey;
    setIsReconcilingReady(true);
    setReadyRefreshFailed(false);
    void (async () => {
      try {
        await Promise.all([
          utils.content.catalog.invalidate(),
          utils.content.adminGet.invalidate(),
        ]);
        await onCompleted(job);
        notifiedReadyJobRef.current = job.id;
        setMessage(null);
      } catch (error) {
        setReadyRefreshFailed(true);
        setMessage(
          friendlyError(
            error,
            "La vidéo est prête, mais la leçon n’a pas pu être actualisée. Réessaie le rafraîchissement."
          )
        );
      } finally {
        setIsReconcilingReady(false);
      }
    })();
  }, [job, onCompleted, readyRefreshAttempt, utils.content.adminGet, utils.content.catalog]);

  useEffect(() => {
    return () => {
      requestRef.current?.abort();
    };
  }, []);

  const validateFile = async (nextFile: File) => {
    if (!nextFile.size) {
      setMessage(
        "Cette vidéo est vide. Choisis le fichier original dans Photos ou Fichiers."
      );
      return false;
    }
    if (nextFile.size > MAX_PHONE_VIDEO_BYTES) {
      setMessage(
        `Cette vidéo fait ${formatBytes(nextFile.size)}. La limite est de 1 Gio.`
      );
      return false;
    }
    if (!getPhoneVideoContentType(nextFile.name, nextFile.type)) {
      setMessage("Choisis une vidéo .mov, .mp4, .m4v, .webm, .3gp ou .3g2.");
      return false;
    }

    const durationSeconds = await getFileDuration(nextFile);
    if (durationSeconds && durationSeconds > MAX_PHONE_VIDEO_SECONDS) {
      setMessage(
        "Cette vidéo dépasse 30 minutes. Raccourcis-la avant de réessayer."
      );
      return false;
    }
    return true;
  };

  const startUpload = async (nextFile: File) => {
    if (!canStart) {
      setMessage(
        "Enregistre d’abord cette leçon sans modification avant de téléverser une vidéo."
      );
      return;
    }

    const contentType = getPhoneVideoContentType(nextFile.name, nextFile.type);
    if (!contentType) {
      setMessage("Le type de cette vidéo n’est pas pris en charge.");
      return;
    }

    onActiveChange(true);
    setIsStarting(true);
    setMessage(null);
    setRetryKind(null);
    setProgress(0);
    let preparedJobId: string | null = null;
    let transferComplete = false;
    try {
      const prepared = await prepare.mutateAsync({
        lessonId,
        revision,
        filename: nextFile.name,
        contentType,
        size: nextFile.size,
      });
      preparedJobId = prepared.jobId;
      const nextJob: VideoJobInfo = {
        id: prepared.jobId,
        lessonId,
        status: "uploading",
        progress: 0,
        filename: nextFile.name,
      };
      setJobId(prepared.jobId);
      setJob(nextJob);
      await onJobStarted();

      if (cancelledJobRef.current === prepared.jobId) return;
      const upload = createPutRequest(
        prepared.uploadUrl,
        nextFile,
        prepared.contentType,
        setProgress
      );
      requestRef.current = upload.request;
      await upload.promise;
      requestRef.current = null;
      setProgress(100);
      transferComplete = true;

      if (cancelledJobRef.current === prepared.jobId) return;
      const finished = await finish.mutateAsync({ id: prepared.jobId });
      setJob(finished);
      setRetryKind(null);
    } catch (error) {
      requestRef.current = null;
      if (error instanceof UploadAbortedError) return;

      setRetryKind(
        preparedJobId ? (transferComplete ? "finish" : "transfer") : "prepare"
      );
      setMessage(
        friendlyError(
          error,
          "Le téléversement n’a pas pu être lancé. Vérifie ta connexion et réessaie."
        )
      );
    } finally {
      setIsStarting(false);
    }
  };

  const chooseFile = async (nextFile: File) => {
    if (isBusy) return;
    setFile(nextFile);
    setMessage(null);
    if (await validateFile(nextFile)) {
      await startUpload(nextFile);
    }
  };

  const onFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const [nextFile] = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (nextFile) void chooseFile(nextFile);
  };

  const cancelJob = async (): Promise<boolean> => {
    const id = jobId;
    if (!id || isCancelling) return false;

    cancelledJobRef.current = id;
    requestRef.current?.abort();
    requestRef.current = null;
    setIsCancelling(true);
    setMessage(null);
    try {
      const cancelled = await cancel.mutateAsync({ id });
      setJob(cancelled);
      setRetryKind(null);
      setProgress(0);
      return true;
    } catch (error) {
      cancelledJobRef.current = null;
      setMessage(
        friendlyError(
          error,
          "L’annulation n’a pas pu être confirmée. Réessaie."
        )
      );
      return false;
    } finally {
      setIsCancelling(false);
    }
  };

  const retryTransfer = async () => {
    if (!file) {
      setMessage("Choisis de nouveau la vidéo à téléverser.");
      photosInputRef.current?.click();
      return;
    }
    const previousJobId = jobId;
    if (previousJobId && !(await cancelJob())) return;
    if (cancelledJobRef.current === previousJobId) {
      cancelledJobRef.current = null;
    }
    await startUpload(file);
  };

  const retryFinish = async () => {
    if (!jobId) return;
    setMessage(null);
    try {
      const finished = await finish.mutateAsync({ id: jobId });
      setJob(finished);
      setRetryKind(null);
    } catch (error) {
      setMessage(
        friendlyError(
          error,
          "La confirmation du téléversement a échoué. Réessaie."
        )
      );
    }
  };

  const retryConversion = async () => {
    if (!jobId) return;
    if (!canStart) {
      setMessage(
        "Enregistre d’abord tes modifications avant de relancer la conversion."
      );
      return;
    }
    setMessage(null);
    try {
      const retried = await retry.mutateAsync({ id: jobId });
      setJob(retried);
    } catch (error) {
      setMessage(
        friendlyError(
          error,
          "La conversion n’a pas pu être relancée. Réessaie."
        )
      );
    }
  };

  const chooseReplacement = async () => {
    if (jobId && job?.status !== "cancelled" && !(await cancelJob())) return;
    photosInputRef.current?.click();
  };

  const status = job?.status;
  const statusText = isStarting
    ? "Préparation du téléversement"
    : status
      ? statusLabels[status]
      : "Prête à téléverser";
  const statusProgress =
    status === "processing" || status === "queued"
      ? (job?.progress ?? 0)
      : progress;
  const isMutating =
    prepare.isPending ||
    finish.isPending ||
    retry.isPending ||
    cancel.isPending;
  const canChoose = canStart && !isBusy && !isMutating;

  return (
    <section className="phone-video-upload" aria-labelledby="phone-video-title">
      <input
        ref={photosInputRef}
        className="phone-video-upload-input"
        id={`phone-video-photos-${lessonId}`}
        type="file"
        accept={`video/*,${PHONE_VIDEO_ACCEPT}`}
        onChange={onFileInput}
        tabIndex={-1}
      />
      <input
        ref={cameraInputRef}
        className="phone-video-upload-input"
        id={`phone-video-camera-${lessonId}`}
        type="file"
        accept={`video/*,${PHONE_VIDEO_ACCEPT}`}
        capture="environment"
        onChange={onFileInput}
        tabIndex={-1}
      />

      <div className="phone-video-upload-heading">
        <div>
          <h4 id="phone-video-title">
            <FileVideo size={17} aria-hidden="true" /> Importer une vidéo de
            téléphone
          </h4>
          <p>
            Envoie l’original depuis Photos ou Fichiers. La conversion continue
            ensuite sur le serveur.
          </p>
        </div>
        <span
          className={`phone-video-status ${status ? `is-${status}` : ""}`}
          aria-live="polite"
        >
          {status === "ready" ? (
            <CheckCircle2 size={14} aria-hidden="true" />
          ) : status === "failed" ? (
            <AlertCircle size={14} aria-hidden="true" />
          ) : isBusy ? (
            <LoaderCircle
              size={14}
              className="phone-video-spin"
              aria-hidden="true"
            />
          ) : null}
          {statusText}
        </span>
      </div>

      {isJobActive && (
        <div className="phone-video-progress" role="status" aria-live="polite">
          <div className="phone-video-progress-copy">
            <strong>
              {status === "processing" || status === "queued"
                ? "Ta vidéo est convertie de façon sécurisée."
                : "Téléversement de la vidéo originale en cours."}
            </strong>
            <span>
              {status === "processing" || status === "queued"
                ? "Tu peux quitter cette page : la conversion se poursuit côté serveur."
                : "Garde ton téléphone ouvert et connecté jusqu’à la fin du transfert."}
            </span>
          </div>
          <span className="phone-video-progress-value">{statusProgress} %</span>
          <span className="phone-video-progress-track" aria-hidden="true">
            <span
              style={{
                width: `${Math.min(100, Math.max(0, statusProgress))}%`,
              }}
            />
          </span>
          <button
            type="button"
            className="btn secondary phone-video-cancel"
            onClick={() => void cancelJob()}
            disabled={isCancelling || cancel.isPending}
          >
            <X size={16} /> {isCancelling ? "Annulation…" : "Annuler"}
          </button>
        </div>
      )}

      {!status || status === "ready" || status === "cancelled" ? (
        <>
          <div className="phone-video-actions">
            <button
              type="button"
              className="btn primary"
              onClick={() => photosInputRef.current?.click()}
              disabled={!canChoose}
            >
              <Images size={17} /> Photos ou Fichiers
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => cameraInputRef.current?.click()}
              disabled={!canChoose}
            >
              <Camera size={17} /> Utiliser la caméra
            </button>
          </div>
          {!canStart && !isBusy && (
            <p className="phone-video-requirement" role="status">
              Enregistre d’abord la leçon et tes modifications avant de choisir
              une vidéo.
            </p>
          )}
        </>
      ) : null}

      {status === "failed" && (
        <div className="phone-video-recovery">
          <p role="alert">
            <AlertCircle size={16} aria-hidden="true" />
            {job?.error || "La conversion de cette vidéo a échoué."}
          </p>
          <div className="phone-video-actions">
            <button
              type="button"
              className="btn primary"
              onClick={() => void retryConversion()}
              disabled={isMutating}
            >
              <RefreshCw size={16} /> Relancer la conversion
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => void chooseReplacement()}
              disabled={isMutating || !canStart}
            >
              <Upload size={16} /> Choisir une autre vidéo
            </button>
            <button
              type="button"
              className="btn secondary phone-video-cancel"
              onClick={() => void cancelJob()}
              disabled={isMutating}
            >
              <X size={16} /> Annuler
            </button>
          </div>
        </div>
      )}

      {message && (
        <p className="phone-video-message" role="alert">
          <AlertCircle size={16} aria-hidden="true" /> {message}
        </p>
      )}

      {readyRefreshFailed && (
        <button
          type="button"
          className="btn secondary"
          disabled={isReconcilingReady}
          onClick={() => setReadyRefreshAttempt(value => value + 1)}
        >
          <RefreshCw size={16} /> Réessayer le rafraîchissement
        </button>
      )}

      {retryKind === "prepare" && (
        <div className="phone-video-recovery">
          <p>Le téléversement n’a pas pu être préparé.</p>
          <div className="phone-video-actions">
            <button
              type="button"
              className="btn primary"
              onClick={() => file && void startUpload(file)}
              disabled={isMutating || !file || !canStart}
            >
              <RefreshCw size={16} /> Réessayer le téléversement
            </button>
          </div>
        </div>
      )}

      {retryKind === "transfer" && (
        <div className="phone-video-recovery">
          <p>
            Le transfert a été interrompu. Il doit recommencer depuis le début;
            aucun téléversement par morceaux n’est repris.
          </p>
          <div className="phone-video-actions">
            <button
              type="button"
              className="btn primary"
              onClick={() => void retryTransfer()}
              disabled={isMutating}
            >
              <RefreshCw size={16} /> Réessayer le transfert
            </button>
            <button
              type="button"
              className="btn secondary phone-video-cancel"
              onClick={() => void cancelJob()}
              disabled={isMutating}
            >
              <X size={16} /> Annuler
            </button>
          </div>
        </div>
      )}

      {retryKind === "finish" && status === "uploading" && (
        <div className="phone-video-recovery">
          <p>La vidéo a été envoyée, mais sa confirmation n’a pas abouti.</p>
          <div className="phone-video-actions">
            <button
              type="button"
              className="btn primary"
              onClick={() => void retryFinish()}
              disabled={isMutating}
            >
              <RefreshCw size={16} /> Confirmer le téléversement
            </button>
            <button
              type="button"
              className="btn secondary phone-video-cancel"
              onClick={() => void cancelJob()}
              disabled={isMutating}
            >
              <X size={16} /> Annuler
            </button>
          </div>
        </div>
      )}

      {jobQuery.isError && isJobActive && (
        <p className="phone-video-polling-note" role="status">
          Le suivi se reconnecte. Ta conversion reste sécurisée côté serveur.
        </p>
      )}

      <p className="phone-video-help">
        Limites : 1 Gio et 30 minutes. Formats acceptés : MOV, MP4, M4V, WebM,
        3GP et 3G2. Sur iPhone, choisis la vidéo originale dans Photos, garde
        une connexion stable et laisse l’écran ouvert jusqu’à la fin du
        transfert.
      </p>
    </section>
  );
}
