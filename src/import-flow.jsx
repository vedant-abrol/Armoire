import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowCounterClockwise, ArrowRight, Check, Plus, SpinnerGap, Trash, UploadSimple, WarningCircle, X } from "@phosphor-icons/react";
import {
  analyzeSourcePhoto,
  approveGeneratedGarment,
  createSourcePhoto,
  createPrivatePreviewUrl,
  createSourcePreviewUrl,
  generateGarmentCutout,
  LEGACY_CANDIDATE_MESSAGE,
  listPhotoImports,
  prepareCandidateCrop,
  rejectGeneratedGarment,
  updateImportCandidate,
  verifyGarmentGenerationPrerequisites,
} from "./services/importService.js";
import "./import-flow.css";

const PARTS = [
  ["upperbody", "Tops"],
  ["wholebody_up", "Jackets"],
  ["lowerbody", "Bottoms"],
  ["accessories_up", "Accessories"],
  ["shoes", "Shoes"],
];
const PART_LABELS = Object.fromEntries(PARTS);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const GENERATION_STAGES = ["approved_detection", "reviewed", "generation_ready"];
const PROCESSING_STAGES = ["preparing_crop", "generating_garment", "preparing_cutout"];

function isActionableJob(job) {
  return job.status !== "complete" && job.status !== "rejected" && job.stage !== "complete" && job.stage !== "rejected";
}

function nextActionableJob(jobs, excludedId = "") {
  const available = jobs.filter((job) => job.id !== excludedId && isActionableJob(job));
  return available.find((job) => job.stage === "garment_review")
    || available.find((job) => GENERATION_STAGES.includes(job.stage) || job.stage === "failed")
    || available.find((job) => job.status === "pending" && job.stage === "review")
    || available[0]
    || null;
}

function importTitle(job, processing, activityText) {
  if (processing) return activityText;
  if (!job) return "Add a real photo";
  if (job.status === "pending" && job.stage === "review") return "Review detected piece";
  if (job.stage === "garment_review") return "Approve generated garment";
  if (job.stage === "failed") return "Generation needs attention";
  if (PROCESSING_STAGES.includes(job.stage)) return "Generating garment";
  if (GENERATION_STAGES.includes(job.stage)) return "Generate garment";
  return "Continue import";
}

function errorMessage(error, fallback = "The import could not be completed.") {
  return error?.response?.data?.error || error?.message || fallback;
}

function draftFor(job) {
  return {
    name: job.name || "New piece",
    part: job.part || "upperbody",
    color: job.color || "#d8d0c2",
    secondaryColor: job.secondaryColor || "",
    tags: Array.isArray(job.tags) ? job.tags.join(", ") : "",
  };
}

function boxStyle(box = {}) {
  const x = Math.max(0, Math.min(999, Number(box.x) || 0));
  const y = Math.max(0, Math.min(999, Number(box.y) || 0));
  const width = Math.max(1, Math.min(1000 - x, Number(box.width) || 1000 - x));
  const height = Math.max(1, Math.min(1000 - y, Number(box.height) || 1000 - y));
  return {
    left: `${x / 10}%`,
    top: `${y / 10}%`,
    width: `${width / 10}%`,
    height: `${height / 10}%`,
  };
}

function CandidateImage({ job, photo, previewUrl, large = false, onPreviewExpired }) {
  if (!previewUrl) {
    return <div className={`import-candidate-image${large ? " is-large" : ""} is-loading`} aria-label="Loading private photo"><SpinnerGap className="import-spinner" size={20} /></div>;
  }

  return (
    <div className={`import-candidate-image${large ? " is-large" : ""}`}>
      <img src={previewUrl} alt={large ? `${job.name} detected in ${photo?.originalFilename || "private photo"}` : ""} onError={onPreviewExpired} />
      <span className="import-bounding-box" style={boxStyle(job.boundingBox)} aria-hidden="true" />
    </div>
  );
}

function CandidateEditor({ job, photo, previewUrl, draft, setDraft, busy, onDecision, onPreviewExpired }) {
  const primaryValid = HEX_COLOR.test(draft.color);
  const secondaryValid = !draft.secondaryColor || HEX_COLOR.test(draft.secondaryColor);
  const tags = draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean);
  const tagsValid = tags.length >= 1 && tags.length <= 4;
  const pending = job.status === "pending" && job.stage === "review";

  return (
    <div className="import-editor">
      <CandidateImage job={job} photo={photo} previewUrl={previewUrl} large onPreviewExpired={onPreviewExpired} />
      <div className="import-fields">
        <p className="import-editor__stage">Detected candidate · {Math.round(job.detectionConfidence * 100)}% confidence</p>
        <div className="import-field"><label htmlFor={`name-${job.id}`}>Name</label><input id={`name-${job.id}`} value={draft.name} disabled={!pending} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></div>
        <div className="import-field"><label htmlFor={`part-${job.id}`}>Category</label><select id={`part-${job.id}`} value={draft.part} disabled={!pending} onChange={(event) => setDraft({ ...draft, part: event.target.value })}>{PARTS.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></div>
        <div className="import-field"><label htmlFor={`primary-${job.id}`}>Primary color</label><div className="import-color-row"><input id={`primary-${job.id}`} type="color" value={primaryValid ? draft.color : "#000000"} disabled={!pending} onChange={(event) => setDraft({ ...draft, color: event.target.value })} /><input aria-label="Primary color hex" aria-invalid={!primaryValid} value={draft.color} disabled={!pending} onChange={(event) => setDraft({ ...draft, color: event.target.value })} /></div>{!primaryValid && <small className="import-field-error">Use a six-digit hex color, such as #d8d0c2.</small>}</div>
        <div className="import-field"><label htmlFor={`secondary-${job.id}`}>Secondary color <span>optional</span></label><input id={`secondary-${job.id}`} aria-invalid={!secondaryValid} value={draft.secondaryColor} disabled={!pending} placeholder="#hex or leave blank" onChange={(event) => setDraft({ ...draft, secondaryColor: event.target.value })} />{!secondaryValid && <small className="import-field-error">Use a six-digit hex color or leave this empty.</small>}</div>
        <div className="import-field"><label htmlFor={`tags-${job.id}`}>Details <span>1–4, separated by commas</span></label><input id={`tags-${job.id}`} aria-invalid={!tagsValid} value={draft.tags} disabled={!pending} placeholder="cotton, striped, relaxed" onChange={(event) => setDraft({ ...draft, tags: event.target.value })} />{!tagsValid && <small className="import-field-error">Keep between one and four useful details.</small>}</div>
        <div className="import-actions">
          {pending ? (
            <>
              <button className="import-button" disabled={busy} onClick={() => onDecision("rejected")}><Trash size={14} /> Reject</button>
              <button className="import-button import-button--primary" disabled={busy || !draft.name.trim() || !primaryValid || !secondaryValid || !tagsValid} onClick={() => onDecision("approved")}><Check size={14} weight="bold" /> Approve candidate</button>
            </>
          ) : <p className={`import-decision is-${job.status}`}>{job.status === "approved" ? <Check size={14} /> : <X size={14} />} {job.status === "approved" ? "Candidate approved" : "Candidate rejected"}</p>}
        </div>
      </div>
    </div>
  );
}

const GENERATION_STAGE_COPY = {
  preparing_crop: "Preparing focused crop",
  generation_ready: "Ready to generate",
  generating_garment: "Reconstructing the garment",
  preparing_cutout: "Removing the generated background",
  garment_review: "Generated garment",
  reviewed: "Ready to generate",
  approved_detection: "Ready to generate",
  failed: "Generation needs attention",
  rejected: "Generated garment rejected",
  complete: "Added to your wardrobe",
};

function GeneratedGarmentEditor({ job, photo, sourcePreviewUrl, generatedPreviewUrl, direction, setDirection, busy, deduplication, onApprove, onDeduplicationDecision, onRegenerate, onReject, onSourcePreviewExpired, onGeneratedPreviewExpired }) {
  const ready = job.stage === "garment_review" && job.generationStatus === "ready";
  const failed = job.stage === "failed" || job.generationStatus === "failed";
  const needsGeneration = GENERATION_STAGES.includes(job.stage) && job.status === "approved";
  const generationReady = job.stage === "generation_ready" && job.generationStatus === "ready_to_generate";
  const complete = job.stage === "complete" || job.status === "complete";
  const rejected = job.stage === "rejected" || job.status === "rejected";
  const processing = ["preparing_crop", "generating_garment", "preparing_cutout"].includes(job.stage);
  const reviewingMatch = deduplication?.status === "review_required";

  return (
    <div className="import-generation-editor">
      {reviewingMatch ? (
        <div className="import-dedup-comparison" aria-label="Possible wardrobe match">
          <figure>
            <div className="import-generated-preview"><img src={deduplication.existingItem.image} alt={deduplication.existingItem.name || "Existing garment"} /></div>
            <figcaption>Existing garment</figcaption>
          </figure>
          <figure>
            <div className="import-generated-preview"><img src={generatedPreviewUrl} alt={`New ${job.name} candidate`} onError={onGeneratedPreviewExpired} /></div>
            <figcaption>New candidate</figcaption>
          </figure>
        </div>
      ) : <div className="import-generated-preview">
        {generatedPreviewUrl ? (
          <img src={generatedPreviewUrl} alt={`Generated ${job.name}`} onError={onGeneratedPreviewExpired} />
        ) : processing || failed || needsGeneration ? (
          <CandidateImage job={job} photo={photo} previewUrl={sourcePreviewUrl} large onPreviewExpired={onSourcePreviewExpired} />
        ) : (
          <div className="import-generated-preview__loading"><SpinnerGap className="import-spinner" size={22} /></div>
        )}
      </div>}
      <div className="import-fields">
        <p className="import-editor__stage">{reviewingMatch ? "Physical item check" : GENERATION_STAGE_COPY[job.stage] || "Garment generation"}</p>
        <div className="import-generation-copy">
          <h3>{reviewingMatch ? "Is this already in your wardrobe?" : job.name}</h3>
          {reviewingMatch && <><p>{deduplication.reason}</p><p>{Math.round(deduplication.confidence * 100)}% same-item confidence · nothing is merged without your confirmation.</p></>}
          {processing && <p><SpinnerGap className="import-spinner" size={15} /> {GENERATION_STAGE_COPY[job.stage]}. This can take up to two minutes.</p>}
          {ready && <p>Review the isolated garment against the original photo before adding it to your wardrobe.</p>}
          {needsGeneration && !generationReady && <p>This detected piece is approved. The next step prepares its private crop and generates the wardrobe cutout.</p>}
          {generationReady && <p><ArrowRight size={15} /> Next, choose Generate garment below. This uses one image request, then you’ll approve the finished cutout.</p>}
          {failed && <p className="is-error">{job.generationError || job.error || "The garment could not be generated."}</p>}
          {complete && <p className="is-complete"><Check size={15} /> {job.deduplicationStatus === "same_item" ? "An existing wardrobe piece was recognized." : "This piece is now in your Armoire."}</p>}
          {rejected && <p>The generated garment was rejected.</p>}
        </div>
        {!reviewingMatch && (ready || failed || needsGeneration) && (
          <div className="import-field">
            <label htmlFor={`regenerate-${job.id}`}>Optional regeneration instruction</label>
            <textarea id={`regenerate-${job.id}`} rows="3" maxLength="500" value={direction} disabled={busy} placeholder="Preserve the zipper exactly" onChange={(event) => setDirection(event.target.value)} />
          </div>
        )}
        <div className="import-actions">
          {reviewingMatch ? <>
            <button className="import-button" disabled={busy} onClick={() => onDeduplicationDecision("add_new")}>Add as new</button>
            <button className="import-button import-button--primary" disabled={busy} onClick={() => onDeduplicationDecision("same_item")}><Check size={14} weight="bold" /> Same item</button>
          </> : <>
            {(ready || failed || needsGeneration) && <button className="import-button" disabled={busy} onClick={onReject}><Trash size={14} /> Reject</button>}
            {(ready || failed || needsGeneration) && <button className="import-button" disabled={busy} onClick={onRegenerate}>{needsGeneration ? <ArrowRight size={14} /> : <ArrowCounterClockwise size={14} />} {needsGeneration ? "Generate garment" : "Try generation again"}</button>}
            {ready && <button className="import-button import-button--primary" disabled={busy} onClick={onApprove}><Check size={14} weight="bold" /> Approve</button>}
          </>}
          {processing && <p className="import-decision"><SpinnerGap className="import-spinner" size={14} /> Working from the original crop</p>}
          {complete && <p className="import-decision is-approved"><Check size={14} /> {job.deduplicationStatus === "same_item" ? "Appearance recorded" : "Wardrobe item created"}</p>}
          {rejected && <p className="import-decision"><X size={14} /> Rejected</p>}
        </div>
      </div>
    </div>
  );
}

export function WardrobeImportFlow({ onWardrobeChanged }) {
  const inputRef = useRef(null);
  const previewRequests = useRef(new Set());
  const [photos, setPhotos] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [sessionPhotoIds, setSessionPhotoIds] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [previewUrls, setPreviewUrls] = useState({});
  const [generatedPreviewUrls, setGeneratedPreviewUrls] = useState({});
  const [regenerationDirections, setRegenerationDirections] = useState({});
  const [deduplicationReviews, setDeduplicationReviews] = useState({});
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedReviewId, setSelectedReviewId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(null);

  const applyImports = useCallback(({ photos: nextPhotos, jobs: nextJobs }) => {
    setPhotos(nextPhotos);
    setJobs(nextJobs);
    setDrafts((current) => ({
      ...Object.fromEntries(nextJobs.map((job) => [job.id, current[job.id] || draftFor(job)])),
    }));
    setSelectedReviewId((current) => {
      if (nextJobs.some((job) => job.id === current && isActionableJob(job))) return current;
      return nextActionableJob(nextJobs)?.id || null;
    });
  }, []);

  const replaceJob = useCallback((updated) => {
    setJobs((current) => current.map((job) => job.id === updated.id ? updated : job));
    setDrafts((current) => ({ ...current, [updated.id]: current[updated.id] || draftFor(updated) }));
    return updated;
  }, []);

  const refreshImports = useCallback(async () => {
    const imports = await listPhotoImports();
    applyImports(imports);
    return imports;
  }, [applyImports]);

  useEffect(() => {
    let active = true;
    listPhotoImports()
      .then((imports) => { if (active) applyImports(imports); })
      .catch((requestError) => { if (active) setError(errorMessage(requestError, "Your import queue could not be loaded.")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [applyImports]);

  const loadPreview = useCallback(async (photo, force = false) => {
    if (!photo?.privateFileUri || (!force && (previewUrls[photo.id] || previewRequests.current.has(photo.id)))) return;
    previewRequests.current.add(photo.id);
    try {
      const url = await createSourcePreviewUrl(photo.privateFileUri);
      setPreviewUrls((current) => ({ ...current, [photo.id]: url }));
    } catch (requestError) {
      setError(errorMessage(requestError, "A private photo preview could not be opened."));
    } finally {
      previewRequests.current.delete(photo.id);
    }
  }, [previewUrls]);

  const loadGeneratedPreview = useCallback(async (job, force = false) => {
    const privateFileUri = job?.generatedCutoutUri;
    const current = generatedPreviewUrls[job?.id];
    const requestKey = `generated:${job?.id}:${privateFileUri}`;
    if (!job?.id || !privateFileUri || (!force && (current?.uri === privateFileUri || previewRequests.current.has(requestKey)))) return;
    previewRequests.current.add(requestKey);
    try {
      const url = await createPrivatePreviewUrl(privateFileUri);
      setGeneratedPreviewUrls((existing) => ({ ...existing, [job.id]: { uri: privateFileUri, url } }));
    } catch (requestError) {
      setError(errorMessage(requestError, "The generated garment preview could not be opened."));
    } finally {
      previewRequests.current.delete(requestKey);
    }
  }, [generatedPreviewUrls]);

  useEffect(() => {
    const requiredPhotoIds = new Set();
    if (photos[0]?.id) requiredPhotoIds.add(photos[0].id);
    if (open) jobs.forEach((job) => requiredPhotoIds.add(job.sourcePhotoId));
    photos.filter((photo) => requiredPhotoIds.has(photo.id)).forEach((photo) => loadPreview(photo));
  }, [jobs, loadPreview, open, photos]);

  useEffect(() => {
    if (!open) return;
    jobs.filter((job) => job.generatedCutoutUri).forEach((job) => loadGeneratedPreview(job));
  }, [jobs, loadGeneratedPreview, open]);

  const submitFiles = useCallback(async (fileList) => {
    const images = [...fileList].filter((file) => file.type.startsWith("image/"));
    if (!images.length) return;

    setDragging(false);
    setOpen(true);
    setError("");
    setNotice(null);
    setProcessing({ total: images.length, completed: 0 });

    for (const file of images) {
      try {
        const photo = await createSourcePhoto(file);
        setSessionPhotoIds((current) => current.includes(photo.id) ? current : [...current, photo.id]);
        setPhotos((current) => [photo, ...current]);
        setPhotos((current) => current.map((item) => item.id === photo.id ? { ...item, status: "analyzing" } : item));
        const result = await analyzeSourcePhoto(photo.id);
        setPhotos((current) => current.map((item) => item.id === photo.id ? result.sourcePhoto : item));
        setJobs((current) => {
          const ids = new Set(result.jobs.map((job) => job.id));
          return [...current.filter((job) => !ids.has(job.id)), ...result.jobs];
        });
        setDrafts((current) => ({ ...current, ...Object.fromEntries(result.jobs.map((job) => [job.id, draftFor(job)])) }));
        setSelectedReviewId((current) => current || result.jobs[0]?.id || null);
        if (!result.jobs.length) {
          setNotice({ text: "No clothing detected", detail: `We couldn’t find a distinct wearable item in ${file.name}. Try a clearer or more tightly framed photo.` });
        } else {
          setNotice({ text: "Garments detected", detail: `${result.jobs.length} garment ${result.jobs.length === 1 ? "appearance" : "appearances"} detected in ${file.name}.` });
        }
      } catch (requestError) {
        setError(errorMessage(requestError, `Could not analyze ${file.name}.`));
      } finally {
        setProcessing((current) => current ? { ...current, completed: current.completed + 1 } : current);
      }
    }

    try {
      await refreshImports();
    } catch (requestError) {
      setError(errorMessage(requestError, "The latest import state could not be refreshed."));
    } finally {
      setProcessing(null);
    }
  }, [refreshImports]);

  useEffect(() => {
    let depth = 0;
    const onDragEnter = (event) => { if (![...event.dataTransfer.types].includes("Files")) return; event.preventDefault(); depth += 1; setDragging(true); };
    const onDragOver = (event) => { if ([...event.dataTransfer.types].includes("Files")) event.preventDefault(); };
    const onDragLeave = (event) => { event.preventDefault(); depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
    const onDrop = (event) => { event.preventDefault(); depth = 0; setDragging(false); submitFiles(event.dataTransfer.files); };
    const onPaste = (event) => { const files = [...event.clipboardData.files]; if (files.some((file) => file.type.startsWith("image/"))) { event.preventDefault(); submitFiles(files); } };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("paste", onPaste);
    };
  }, [submitFiles]);

  const decide = async (job, decision) => {
    setBusyId(job.id);
    setError("");
    try {
      const draft = drafts[job.id] || draftFor(job);
      const tags = [...new Set(draft.tags.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 4);
      const changes = decision === "approved"
        ? {
          name: draft.name.trim(),
          part: draft.part,
          color: draft.color.toLowerCase(),
          secondaryColor: draft.secondaryColor ? draft.secondaryColor.toLowerCase() : "",
          tags,
          status: "approved",
          stage: "approved_detection",
          generationStatus: "idle",
          generationError: "",
          error: "",
        }
        : { status: "rejected", stage: "rejected", generationStatus: "rejected" };
      let updated = replaceJob(await updateImportCandidate(job.id, changes));
      if (decision === "approved") {
        if (!job.sourcePhotoId) throw new Error(LEGACY_CANDIDATE_MESSAGE);
        const photo = photoById[job.sourcePhotoId];
        if (!photo) throw new Error("Source photo record no longer exists");
        if (!photo.privateFileUri) throw new Error("Source photo is missing privateFileUri");
        updated = replaceJob(await prepareCandidateCrop(updated, photo.privateFileUri));
        await verifyGarmentGenerationPrerequisites(updated);
        setRegenerationDirections((current) => ({ ...current, [job.id]: "" }));
        setNotice({ text: "Ready to generate", detail: `${updated.name} is prepared. Choose Generate garment to create the cutout.` });
      } else {
        setSelectedReviewId(nextActionableJob(jobs, job.id)?.id || null);
      }
    } catch (requestError) {
      setError(errorMessage(requestError, decision === "approved" ? "The garment could not be generated." : "This candidate could not be updated."));
      await refreshImports().catch(() => {});
    } finally {
      setBusyId(null);
    }
  };

  const regenerate = async (job) => {
    setBusyId(job.id);
    setError("");
    setNotice(null);
    try {
      let sourceJob = job;
      if (!sourceJob.candidateCropUri) {
        if (!job.sourcePhotoId) throw new Error(LEGACY_CANDIDATE_MESSAGE);
        sourceJob = replaceJob(await updateImportCandidate(job.id, {
          status: "approved",
          stage: "preparing_crop",
          generationStatus: "preparing_crop",
          generationError: "",
          error: "",
        }));
        const photo = photoById[job.sourcePhotoId];
        if (!photo) throw new Error("Source photo record no longer exists");
        if (!photo.privateFileUri) throw new Error("Source photo is missing privateFileUri");
        sourceJob = replaceJob(await prepareCandidateCrop(sourceJob, photo.privateFileUri));
      }
      await verifyGarmentGenerationPrerequisites(sourceJob, regenerationDirections[job.id] || "");
      replaceJob({ ...sourceJob, status: "approved", stage: "generating_garment", generationStatus: "generating", generationError: "", error: "" });
      const updated = replaceJob(await generateGarmentCutout(sourceJob, regenerationDirections[job.id] || ""));
      setRegenerationDirections((current) => ({ ...current, [job.id]: "" }));
      setNotice({ text: "Generated garment ready", detail: `Review the ${updated.name} cutout, then approve it or try generation again.` });
    } catch (requestError) {
      setError(errorMessage(requestError, "The garment could not be regenerated."));
      await refreshImports().catch(() => {});
    } finally {
      setBusyId(null);
    }
  };

  const rejectGarment = async (job) => {
    setBusyId(job.id);
    setError("");
    try {
      replaceJob(await rejectGeneratedGarment(job.id));
      setSelectedReviewId(nextActionableJob(jobs, job.id)?.id || null);
      setNotice({ text: "Generated garment rejected", detail: `${job.name} was not added to your wardrobe.` });
    } catch (requestError) {
      setError(errorMessage(requestError, "The generated garment could not be rejected."));
    } finally {
      setBusyId(null);
    }
  };

  const approveGarment = async (job, deduplicationDecision = "") => {
    setBusyId(job.id);
    setError("");
    try {
      const result = await approveGeneratedGarment(job.id, deduplicationDecision);
      replaceJob(result.job);
      if (result.deduplication?.status === "review_required") {
        setDeduplicationReviews((current) => ({ ...current, [job.id]: result.deduplication }));
        setNotice({ text: "Possible existing piece", detail: "Confirm whether these are the same physical garment before continuing." });
        return;
      }
      setDeduplicationReviews((current) => {
        const next = { ...current };
        delete next[job.id];
        return next;
      });
      await onWardrobeChanged?.(result.item);
      setSelectedReviewId(nextActionableJob(jobs, job.id)?.id || null);
      setNotice(result.deduplication?.existingWardrobePieceRecognized
        ? { text: "Existing piece recognized", detail: `1 existing wardrobe piece recognized. ${job.name} now has another real appearance.` }
        : { text: "Added to wardrobe", detail: `${job.name} now appears in your Armoire.` });
    } catch (requestError) {
      setError(errorMessage(requestError, "The generated garment could not be added to your wardrobe."));
    } finally {
      setBusyId(null);
    }
  };

  const retryPhoto = async (photo) => {
    setBusyId(`photo:${photo.id}`);
    setError("");
    setNotice(null);
    try {
      setPhotos((current) => current.map((item) => item.id === photo.id ? { ...item, status: "analyzing", analysisError: "" } : item));
      await analyzeSourcePhoto(photo.id);
      await refreshImports();
    } catch (requestError) {
      setError(errorMessage(requestError, `Could not analyze ${photo.originalFilename}.`));
      await refreshImports().catch(() => {});
    } finally {
      setBusyId(null);
    }
  };

  const photoById = useMemo(() => Object.fromEntries(photos.map((photo) => [photo.id, photo])), [photos]);
  const activeJobs = jobs.filter(isActionableJob);
  const pendingCount = activeJobs.filter((job) => job.status === "pending" && job.stage === "review").length;
  const garmentReviewCount = activeJobs.filter((job) => job.stage === "garment_review" && job.generationStatus === "ready").length;
  const approvedCandidateCount = activeJobs.filter((job) => job.status === "approved" && GENERATION_STAGES.includes(job.stage)).length;
  const generatingCount = activeJobs.filter((job) => PROCESSING_STAGES.includes(job.stage)).length;
  const failedGenerationCount = activeJobs.filter((job) => job.stage === "failed").length;
  const sessionPhotoIdSet = new Set(sessionPhotoIds);
  const failedPhotos = photos.filter((photo) => sessionPhotoIdSet.has(photo.id) && photo.status === "failed");
  const emptyPhotos = photos.filter((photo) => sessionPhotoIdSet.has(photo.id) && photo.status === "review" && photo.detectedItemCount === 0);
  const selectedJob = activeJobs.find((job) => job.id === selectedReviewId)
    || nextActionableJob(activeJobs)
    || null;
  const latestPhoto = selectedJob ? photoById[selectedJob.sourcePhotoId] : photos.find((photo) => sessionPhotoIdSet.has(photo.id));
  const remainingCount = activeJobs.length;
  const activityText = processing
    ? `Analyzing ${processing.total} ${processing.total === 1 ? "photo" : "photos"}`
    : remainingCount
      ? `Continue import · ${remainingCount} ${remainingCount === 1 ? "piece" : "pieces"} left`
      : failedPhotos.length
        ? "Import needs attention"
        : notice?.text || "Add clothes";
  const queueSummary = [
    pendingCount ? `${pendingCount} to review` : "",
    approvedCandidateCount ? `${approvedCandidateCount} to generate` : "",
    garmentReviewCount ? `${garmentReviewCount} to approve` : "",
    generatingCount ? `${generatingCount} processing` : "",
    failedGenerationCount ? `${failedGenerationCount} ${failedGenerationCount === 1 ? "needs" : "need"} attention` : "",
  ].filter(Boolean).join(" · ");
  const hasActivity = Boolean(processing || remainingCount || failedPhotos.length || notice || error);

  const clearImportQueue = async () => {
    const unfinishedCount = activeJobs.length;
    const description = unfinishedCount
      ? `Discard ${unfinishedCount} unfinished ${unfinishedCount === 1 ? "piece" : "pieces"}? Anything already added to your wardrobe will stay there.`
      : "Clear this import message? Anything already added to your wardrobe will stay there.";
    if (!window.confirm(description)) return;

    setBusyId("clear-import");
    setError("");
    try {
      const cleared = await Promise.all(activeJobs.map((job) => updateImportCandidate(job.id, {
        status: "rejected",
        stage: "rejected",
        generationStatus: "rejected",
        generationError: "",
        error: "",
      })));
      const clearedById = new Map(cleared.map((job) => [job.id, job]));
      setJobs((current) => current.map((job) => clearedById.get(job.id) || job));
      setSelectedReviewId(null);
      setSessionPhotoIds([]);
      setDeduplicationReviews({});
      setNotice({ text: "Import cleared", detail: "The unfinished queue was discarded. Items already in your wardrobe were not changed." });
    } catch (requestError) {
      setError(errorMessage(requestError, "The import queue could not be cleared."));
      await refreshImports().catch(() => {});
    } finally {
      setBusyId(null);
    }
  };

  const finishImport = () => {
    setOpen(false);
    setNotice(null);
    setError("");
    setSessionPhotoIds([]);
  };

  const closeImport = () => {
    if (!remainingCount && !processing && !failedPhotos.length) {
      finishImport();
      return;
    }
    setOpen(false);
  };

  return (
    <>
      <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(event) => { submitFiles(event.target.files); event.target.value = ""; }} />
      <div className="import-drop-overlay" data-active={dragging} aria-hidden={!dragging}><div className="import-drop-target is-over"><UploadSimple size={34} weight="light" /><h2>Drop personal photos</h2><p>A single garment or a full outfit works. Source photos stay in private Base44 storage.</p></div></div>
      <aside className={`import-tray${hasActivity ? " is-expanded" : ""}`} aria-label="Wardrobe imports">
        <button className="import-tray__button" type="button" onClick={() => hasActivity ? setOpen(true) : inputRef.current?.click()} aria-label={hasActivity ? "Open import progress" : "Add clothes"}>{processing || generatingCount ? <SpinnerGap size={19} className="import-spinner" /> : failedPhotos.length || failedGenerationCount ? <WarningCircle size={19} /> : remainingCount ? <span>{remainingCount}</span> : <Plus size={19} />}</button>
        <div className="import-tray__actions">{latestPhoto && previewUrls[latestPhoto.id] && <img className="import-tray__preview" src={previewUrls[latestPhoto.id]} alt="" onError={() => loadPreview(latestPhoto, true)} />}<span className="import-tray__label">{activityText}</span><button className="import-icon-button" type="button" onClick={() => inputRef.current?.click()} aria-label="Add another photo" title="Add another photo"><UploadSimple size={17} /></button></div>
      </aside>
      <div className="import-popover-backdrop" data-open={open} onMouseDown={(event) => event.target === event.currentTarget && closeImport()}>
        <section className="import-popover" role="dialog" aria-modal="true" aria-labelledby="import-title">
          <header className="import-popover__header"><div><p className="import-popover__eyebrow">Wardrobe import</p><h2 className="import-popover__title" id="import-title">{notice && !remainingCount && !processing ? notice.text : importTitle(selectedJob, processing, activityText)}</h2></div><button className="import-icon-button" type="button" onClick={closeImport} aria-label="Close import progress"><X size={20} /></button></header>
          {!!remainingCount && !processing && <p className="import-result-summary" aria-live="polite">{remainingCount} {remainingCount === 1 ? "piece" : "pieces"} remaining{queueSummary ? ` · ${queueSummary}` : ""}</p>}
          {loading ? <p className="import-status is-processing">Opening your private imports</p> : !remainingCount && !failedPhotos.length && !processing ? (
            <div className="import-drop-target import-drop-target--finished">{notice ? <Check size={28} /> : <UploadSimple size={28} />}<h2>{notice?.text || "Import a real photo"}</h2><p>{notice?.detail || "Choose a photo of one garment or a full outfit. We’ll detect each piece and guide you through the next action."}</p><div className="import-empty-actions">{notice && <button className="import-button" onClick={finishImport}>Done</button>}<button className="import-button import-button--primary" onClick={() => inputRef.current?.click()}>{notice ? "Add another photo" : "Choose photo"}</button></div></div>
          ) : (
            <>
              {processing && <div className="import-progress is-indeterminate"><div className="import-progress__meta"><span>{activityText}</span><span>{processing.completed} of {processing.total}</span></div><div className="import-progress__track"><div className="import-progress__bar" /></div></div>}
              {selectedJob && selectedJob.status === "pending" && selectedJob.stage === "review" ? (
                <CandidateEditor job={selectedJob} photo={photoById[selectedJob.sourcePhotoId]} previewUrl={previewUrls[selectedJob.sourcePhotoId]} draft={drafts[selectedJob.id] || draftFor(selectedJob)} setDraft={(draft) => setDrafts((current) => ({ ...current, [selectedJob.id]: draft }))} busy={busyId === selectedJob.id} onDecision={(decision) => decide(selectedJob, decision)} onPreviewExpired={() => loadPreview(photoById[selectedJob.sourcePhotoId], true)} />
              ) : selectedJob ? (
                <GeneratedGarmentEditor
                  job={selectedJob}
                  photo={photoById[selectedJob.sourcePhotoId]}
                  sourcePreviewUrl={previewUrls[selectedJob.sourcePhotoId]}
                  generatedPreviewUrl={generatedPreviewUrls[selectedJob.id]?.url}
                  direction={regenerationDirections[selectedJob.id] ?? selectedJob.regenerationDirection ?? ""}
                  setDirection={(value) => setRegenerationDirections((current) => ({ ...current, [selectedJob.id]: value }))}
                  busy={busyId === selectedJob.id}
                  deduplication={deduplicationReviews[selectedJob.id]}
                  onApprove={() => approveGarment(selectedJob)}
                  onDeduplicationDecision={(decision) => approveGarment(selectedJob, decision)}
                  onRegenerate={() => regenerate(selectedJob)}
                  onReject={() => rejectGarment(selectedJob)}
                  onSourcePreviewExpired={() => loadPreview(photoById[selectedJob.sourcePhotoId], true)}
                  onGeneratedPreviewExpired={() => loadGeneratedPreview(selectedJob, true)}
                />
              ) : null}
              {!!activeJobs.length && <div className="import-card-list">{activeJobs.map((job) => {
                const photo = photoById[job.sourcePhotoId];
                const statusText = job.status === "pending" && job.stage === "review"
                  ? `${PART_LABELS[job.part] || "Garment"} · detection review`
                  : job.deduplicationStatus === "same_item"
                    ? "Existing wardrobe piece recognized"
                    : GENERATION_STAGE_COPY[job.stage] || job.generationError || job.error || "Import failed";
                const tone = job.stage === "failed" ? "error" : ["preparing_crop", "generating_garment", "preparing_cutout"].includes(job.stage) ? "processing" : job.status;
                return <article className={`import-card is-${job.status}${selectedJob?.id === job.id ? " is-selected" : ""}`} key={job.id}><CandidateImage job={job} photo={photo} previewUrl={previewUrls[job.sourcePhotoId]} onPreviewExpired={() => loadPreview(photo, true)} /><div className="import-card__body"><h3 className="import-card__title">{job.name}</h3><p className="import-card__detail import-card__detail--status" data-tone={tone}>{statusText}</p></div><div className="import-card__actions"><button className="import-icon-button" onClick={() => { setSelectedReviewId(job.id); setOpen(true); }} aria-label={`Continue ${job.name}`}>{job.stage === "failed" ? <ArrowCounterClockwise size={16} /> : <ArrowRight size={17} />}</button></div></article>;
              })}</div>}
              {(failedPhotos.length > 0 || emptyPhotos.length > 0) && <div className="import-photo-notices">
                {failedPhotos.map((photo) => <div className="import-photo-notice is-error" key={photo.id}><WarningCircle size={17} /><div><strong>{photo.originalFilename}</strong><p>{photo.analysisError || "This photo could not be analyzed."}</p></div><button className="import-button" disabled={busyId === `photo:${photo.id}`} onClick={() => retryPhoto(photo)}><ArrowCounterClockwise size={14} /> Retry</button></div>)}
                {emptyPhotos.map((photo) => <div className="import-photo-notice" key={photo.id}><Check size={17} /><div><strong>{photo.originalFilename}</strong><p>No distinct wearable items were detected.</p></div></div>)}
              </div>}
              <div className="import-queue-actions">
                {(remainingCount > 0 || failedPhotos.length > 0) && <button className="import-button import-button--quiet" disabled={Boolean(busyId) || Boolean(processing)} onClick={clearImportQueue}><Trash size={14} /> Clear remaining</button>}
                <button className="import-button import-button--primary" disabled={Boolean(processing)} onClick={() => inputRef.current?.click()}><Plus size={14} /> Add another photo</button>
              </div>
            </>
          )}
          {notice && !processing && (remainingCount > 0 || failedPhotos.length > 0) && <p className="import-status is-complete">{notice.detail}</p>}
          {error && <p className="import-status is-error" role="alert">{error}</p>}
        </section>
      </div>
    </>
  );
}
