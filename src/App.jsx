import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Plus, Trash, X } from "@phosphor-icons/react";
import { AuthScreen } from "./AuthScreen.jsx";
import { DEMO_COMMERCE_FIXTURES } from "./demoCommerceFixtures.js";
import { WardrobeImportFlow } from "./import-flow.jsx";
import { OptimizedImage } from "./OptimizedImage.jsx";
import { OutfitGallery, OutfitViewer } from "./outfits.jsx";
import { getCurrentUser, logout } from "./services/authService.js";
import { createShopifyCart, searchShopifyProducts } from "./services/commerceService.js";
import {
  deleteOutfit,
  listOutfits,
  listWardrobeAppearances,
  prepareDemoWardrobe,
  saveOutfit,
  styleWardrobeItem,
} from "./services/experienceService.js";
import {
  createWardrobeItem,
  deleteWardrobeItem,
  listWardrobeItems,
  updateWardrobeItem,
} from "./services/wardrobeService.js";

const TYPES = [
  { id: "all", label: "All" },
  { id: "upperbody", label: "Tops", singular: "Top" },
  { id: "wholebody_up", label: "Jackets", singular: "Jacket" },
  { id: "lowerbody", label: "Bottoms", singular: "Bottom" },
  { id: "accessories_up", label: "Accessories", singular: "Accessory" },
  { id: "shoes", label: "Shoes", singular: "Shoes" },
];
const NAV_TYPES = [...TYPES, { id: "outfits", label: "Outfits" }];
const DEMO_EMAIL = "vedant1311nov@gmail.com";
const DEMO_SEED_VERSION = 4;
const DEMO_ITEM_COUNT = 80;

const TYPE_MAP = Object.fromEntries(TYPES.map((type) => [type.id, type]));
const TYPE_ORDER = Object.fromEntries(TYPES.slice(1).map((type, index) => [type.id, index]));
const DEV_TEST_ITEM = {
  name: "Test Black T-Shirt",
  part: "upperbody",
  color: "#191919",
  secondaryColor: null,
  tags: ["test", "casual"],
  image: "/icon.svg",
  thumbnail: "/icon.svg",
  palette: ["#191919"],
  status: "active",
};

function formatMoney(amount, currencyCode) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return "";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode }).format(value);
  } catch {
    return `${currencyCode || ""} ${value.toFixed(2)}`.trim();
  }
}

function emptyCommerceState() {
  return {
    status: "idle",
    source: null,
    authMode: null,
    products: [],
    selectedId: null,
    error: "",
    cartStatus: "idle",
    cartError: "",
    checkoutUrl: "",
  };
}

function rgbToHex(red, green, blue) {
  return `#${[red, green, blue].map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0")).join("")}`;
}

function colorDistance(first, second) {
  return Math.sqrt(
    ((first.red - second.red) ** 2)
    + ((first.green - second.green) ** 2)
    + ((first.blue - second.blue) ** 2),
  );
}

function extractPalette(image) {
  const canvas = document.createElement("canvas");
  canvas.width = 72;
  canvas.height = 72;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const buckets = new Map();

  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3];
    if (alpha < 72) continue;

    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const key = `${Math.round(red / 28)}-${Math.round(green / 28)}-${Math.round(blue / 28)}`;
    const current = buckets.get(key) || { red: 0, green: 0, blue: 0, count: 0 };
    current.red += red;
    current.green += green;
    current.blue += blue;
    current.count += 1;
    buckets.set(key, current);
  }

  const ranked = [...buckets.values()]
    .map((bucket) => ({
      red: Math.round(bucket.red / bucket.count),
      green: Math.round(bucket.green / bucket.count),
      blue: Math.round(bucket.blue / bucket.count),
      count: bucket.count,
    }))
    .sort((a, b) => b.count - a.count);

  const selected = [];
  for (const color of ranked) {
    if (selected.every((existing) => colorDistance(existing, color) > 38)) selected.push(color);
    if (selected.length === 5) break;
  }

  return selected.map((color) => rgbToHex(color.red, color.green, color.blue));
}

function buildSamplingCanvas(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext("2d", { willReadFrequently: true }).drawImage(image, 0, 0);
  return canvas;
}

function sampleImageColor(image, canvas, event) {
  const bounds = image.getBoundingClientRect();
  const scale = Math.min(bounds.width / image.naturalWidth, bounds.height / image.naturalHeight);
  const renderedWidth = image.naturalWidth * scale;
  const renderedHeight = image.naturalHeight * scale;
  const offsetX = (bounds.width - renderedWidth) / 2;
  const offsetY = (bounds.height - renderedHeight) / 2;
  const imageX = Math.floor((event.clientX - bounds.left - offsetX) / scale);
  const imageY = Math.floor((event.clientY - bounds.top - offsetY) / scale);

  if (imageX < 0 || imageY < 0 || imageX >= canvas.width || imageY >= canvas.height) return null;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  for (let radius = 0; radius <= 18; radius += 2) {
    const startX = Math.max(0, imageX - radius);
    const startY = Math.max(0, imageY - radius);
    const width = Math.min(canvas.width - startX, (radius * 2) + 1);
    const height = Math.min(canvas.height - startY, (radius * 2) + 1);
    const data = context.getImageData(startX, startY, width, height).data;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] > 96) return rgbToHex(data[index], data[index + 1], data[index + 2]);
    }
  }

  return null;
}

function GalleryItem({ item, selected, onOpen }) {
  const type = TYPE_MAP[item.part]?.singular || "wardrobe item";

  return (
    <button
      className={`gallery-item${selected ? " selected" : ""}`}
      type="button"
      onClick={() => onOpen(item.id)}
      aria-label={`View ${item.name || type}`}
      aria-pressed={selected}
      data-testid={`wardrobe-item-${item.id}`}
    >
      <OptimizedImage
        src={item.thumbnail || item.image}
        alt=""
        sizes="(max-width: 520px) calc(50vw - 16px), (max-width: 860px) calc(33vw - 18px), 180px"
        breakpoints={[120, 180, 240, 320, 480]}
      />
    </button>
  );
}

function TagEditor({ tags, onChange }) {
  const [input, setInput] = useState("");

  const addTag = () => {
    const nextTag = input.trim().replace(/^#/, "");
    if (!nextTag || tags.some((tag) => tag.toLowerCase() === nextTag.toLowerCase())) return;
    onChange([...tags, nextTag]);
    setInput("");
  };

  return (
    <div className="tag-editor">
      <div className="editable-tags">
        {tags.map((tag) => (
          <span className="editable-tag" key={tag}>
            {tag}
            <button type="button" onClick={() => onChange(tags.filter((existing) => existing !== tag))} aria-label={`Remove ${tag}`}>
              <X size={12} weight="regular" aria-hidden="true" />
            </button>
          </span>
        ))}
      </div>
      <div className="tag-input-row">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              addTag();
            }
          }}
          placeholder="Add a detail"
          aria-label="Add detail tag"
        />
        <button type="button" onClick={addTag} disabled={!input.trim()} aria-label="Add detail">
          <Plus size={15} weight="regular" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function ColorControl({ label, field, value, palette, onChange, sampling, setSampling, optional = false, onClear, onAdd }) {
  if (optional && !value) {
    return (
      <div className="color-slot empty-color-slot">
        <div className="color-slot-heading">
          <span>{label}</span>
          <small>Optional</small>
        </div>
        <p>No distinct secondary color detected.</p>
        <button className="add-secondary-button" type="button" onClick={onAdd}>Add secondary color</button>
      </div>
    );
  }

  return (
    <div className="color-slot">
      <div className="color-slot-heading">
        <span>{label}</span>
        {optional && <button type="button" onClick={onClear}>Remove</button>}
      </div>
      <label className="selected-color-control">
        <input
          type="color"
          value={value || "#9a9286"}
          onChange={(event) => onChange(event.target.value)}
          aria-label={`Choose ${label.toLowerCase()}`}
        />
        <span className="selected-color-copy">
          <small>Selected</small>
          <strong>{value || "Custom"}</strong>
        </span>
      </label>
      <div className="suggestion-heading">
        <span>Image suggestions</span>
        <small>Click to apply</small>
      </div>
      <div className="palette" aria-label={`${label} suggestions from image`}>
        {palette.map((color) => (
          <button
            type="button"
            key={color}
            className={value?.toLowerCase() === color.toLowerCase() ? "active" : ""}
            style={{ backgroundColor: color }}
            onClick={() => onChange(color)}
            aria-label={`Use ${color} as ${label.toLowerCase()}`}
            title={color}
          />
        ))}
      </div>
      <button
        className={`sample-button${sampling === field ? " active" : ""}`}
        type="button"
        onClick={() => setSampling((current) => current === field ? null : field)}
      >
        {sampling === field ? "Cancel picking" : `Pick ${label.toLowerCase()} from image`}
      </button>
    </div>
  );
}

function ItemEditor({ draft, setDraft, palette, sampling, setSampling, sampleStatus }) {
  const suggestedSecondary = palette.find((color) => color.toLowerCase() !== draft.color?.toLowerCase()) || "#9a9286";

  return (
    <div className="item-editor">
      <label className="field">
        <span>Name</span>
        <input
          value={draft.name}
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          placeholder={TYPE_MAP[draft.part]?.singular || "Wardrobe item"}
        />
      </label>

      <label className="field">
        <span>Category</span>
        <select value={draft.part} onChange={(event) => setDraft((current) => ({ ...current, part: event.target.value }))}>
          {TYPES.slice(1).map((type) => <option value={type.id} key={type.id}>{type.label}</option>)}
        </select>
      </label>

      <fieldset className="color-field">
        <legend>Colors</legend>
        <div className="colors-editor">
          <ColorControl
            label="Primary color"
            field="primary"
            value={draft.color}
            palette={palette}
            onChange={(color) => setDraft((current) => ({ ...current, color }))}
            sampling={sampling}
            setSampling={setSampling}
          />
          <ColorControl
            label="Secondary color"
            field="secondary"
            value={draft.secondaryColor}
            palette={palette}
            onChange={(secondaryColor) => setDraft((current) => ({ ...current, secondaryColor }))}
            sampling={sampling}
            setSampling={setSampling}
            optional
            onClear={() => setDraft((current) => ({ ...current, secondaryColor: null }))}
            onAdd={() => setDraft((current) => ({ ...current, secondaryColor: suggestedSecondary }))}
          />
        </div>
        <p className="color-help" aria-live="polite">{sampling ? `Click anywhere on the garment to sample the ${sampling} color.` : sampleStatus || "Primary colors come from the image. A secondary is suggested only when a distinct color has meaningful coverage."}</p>
      </fieldset>

      <div className="field details-field">
        <span>Details</span>
        <TagEditor tags={draft.tags} onChange={(tags) => setDraft((current) => ({ ...current, tags }))} />
      </div>
    </div>
  );
}

function ItemViewer({ item, items, appearanceCount, isDemoAccount, onClose, onSave, onDelete, onStyle, onSaveOutfit }) {
  const closeButtonRef = useRef(null);
  const imageRef = useRef(null);
  const samplingCanvasRef = useRef(null);
  const shakeTimerRef = useRef(null);
  const [sampling, setSampling] = useState(null);
  const [sampleStatus, setSampleStatus] = useState("");
  const [palette, setPalette] = useState(item.palette || []);
  const [draft, setDraft] = useState({ name: item.name || "", part: item.part, color: item.color || "#9a9286", secondaryColor: item.secondaryColor || null, tags: [...(item.tags || [])] });
  const [shaking, setShaking] = useState(false);
  const [closeBlocked, setCloseBlocked] = useState(false);
  const [mutation, setMutation] = useState("idle");
  const [mutationError, setMutationError] = useState("");
  const [styling, setStyling] = useState({ status: "idle", outfits: [], gap: null, gapError: "", error: "" });
  const [commerce, setCommerce] = useState(emptyCommerceState);
  const [savingOutfit, setSavingOutfit] = useState(null);
  const [savedSuggestions, setSavedSuggestions] = useState([]);
  const type = TYPE_MAP[item.part]?.singular || "Wardrobe item";
  const hasModeledImage = Boolean(item.modeledImage);
  const selectedCommerceProduct = commerce.products.find((product) => product.id === commerce.selectedId) || null;
  const usingDemoCommerceFixtures = commerce.source === "demo-fixture";
  const pieceRotation = useMemo(() => {
    const hash = [...item.id].reduce((total, character) => total + character.charCodeAt(0), 0);
    return `${(hash % 9) - 4}deg`;
  }, [item.id]);

  const isDirty = useMemo(() => {
    const normalizedTags = (tags) => tags.map((tag) => tag.trim()).filter(Boolean);
    return JSON.stringify({
      name: draft.name.trim(),
      part: draft.part,
      color: draft.color?.toLowerCase() || null,
      secondaryColor: draft.secondaryColor?.toLowerCase() || null,
      tags: normalizedTags(draft.tags),
    }) !== JSON.stringify({
      name: (item.name || "").trim(),
      part: item.part,
      color: item.color?.toLowerCase() || null,
      secondaryColor: item.secondaryColor?.toLowerCase() || null,
      tags: normalizedTags(item.tags || []),
    });
  }, [draft, item]);

  const nudgeUnsaved = useCallback(() => {
    setCloseBlocked(true);
    setShaking(false);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setShaking(true));
    });
    clearTimeout(shakeTimerRef.current);
    shakeTimerRef.current = setTimeout(() => setShaking(false), 420);
  }, []);

  const requestClose = useCallback(() => {
    if (mutation !== "idle") return;
    if (isDirty) nudgeUnsaved();
    else onClose();
  }, [isDirty, mutation, nudgeUnsaved, onClose]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        if (sampling) setSampling(null);
        else requestClose();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.body.classList.add("viewer-open");
    closeButtonRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("viewer-open");
      clearTimeout(shakeTimerRef.current);
    };
  }, [requestClose, sampling]);

  useEffect(() => {
    if (!isDirty) setCloseBlocked(false);
  }, [isDirty]);

  useEffect(() => {
    setSampling(null);
    setSampleStatus("");
    setMutation("idle");
    setMutationError("");
    setStyling({ status: "idle", outfits: [], gap: null, gapError: "", error: "" });
    setCommerce(emptyCommerceState());
    setSavingOutfit(null);
    setSavedSuggestions([]);
    setPalette(item.palette || []);
    setDraft({ name: item.name || "", part: item.part, color: item.color || "#9a9286", secondaryColor: item.secondaryColor || null, tags: [...(item.tags || [])] });
  }, [item]);

  const cancelEditing = () => {
    setDraft({ name: item.name || "", part: item.part, color: item.color || "#9a9286", secondaryColor: item.secondaryColor || null, tags: [...(item.tags || [])] });
    setSampling(null);
    setSampleStatus("");
    onClose();
  };

  const saveEditing = async () => {
    setMutation("saving");
    setMutationError("");
    try {
      await onSave({ ...item, ...draft, name: draft.name.trim(), tags: draft.tags.map((tag) => tag.trim()).filter(Boolean), palette });
      setSampling(null);
      setSampleStatus("Changes saved.");
    } catch (error) {
      setMutationError(error?.message || "Changes could not be saved.");
    } finally {
      setMutation("idle");
    }
  };

  const deleteEditing = async () => {
    setMutation("deleting");
    setMutationError("");
    try {
      await onDelete(item.id);
    } catch (error) {
      setMutationError(error?.message || "This piece could not be deleted.");
      setMutation("idle");
    }
  };

  const styleThis = async () => {
    setStyling({ status: "loading", outfits: [], gap: null, gapError: "", error: "" });
    setCommerce(emptyCommerceState());
    try {
      const result = await onStyle(item.id);
      setStyling({ status: "ready", outfits: result.outfits, gap: result.gap, gapError: result.gapError, error: "" });
    } catch (error) {
      setStyling({ status: "error", outfits: [], gap: null, gapError: "", error: error?.response?.data?.error || error?.message || "Outfit suggestions could not be prepared." });
    }
  };

  const shopGap = async () => {
    if (!styling.gap?.shopifyQuery) return;
    setCommerce({ ...emptyCommerceState(), status: "loading" });
    try {
      const result = await searchShopifyProducts(styling.gap.shopifyQuery);
      const products = Array.isArray(result?.products) ? result.products.slice(0, 3) : [];
      setCommerce({
        ...emptyCommerceState(),
        status: products.length ? "ready" : "empty",
        source: products.length ? result?.source || "shopify" : null,
        authMode: result?.authMode || null,
        products,
        selectedId: products[0]?.id || null,
        error: products.length ? "" : "No available Shopify products matched this gap. Try again after expanding the demo catalog.",
      });
      if (!products.length && isDemoAccount) {
        setCommerce({
          ...emptyCommerceState(),
          status: "ready",
          source: "demo-fixture",
          products: DEMO_COMMERCE_FIXTURES,
          selectedId: DEMO_COMMERCE_FIXTURES[0].id,
        });
      }
    } catch (error) {
      if (isDemoAccount) {
        setCommerce({
          ...emptyCommerceState(),
          status: "ready",
          source: "demo-fixture",
          products: DEMO_COMMERCE_FIXTURES,
          selectedId: DEMO_COMMERCE_FIXTURES[0].id,
        });
      } else {
        setCommerce({ ...emptyCommerceState(), status: "error", error: error?.message || "Shopify products could not be loaded." });
      }
    }
  };

  const selectProduct = (productId) => {
    setCommerce((current) => ({
      ...current,
      selectedId: productId,
      cartStatus: "idle",
      cartError: "",
      checkoutUrl: "",
    }));
  };

  const addSelectedProduct = async () => {
    const product = commerce.products.find((candidate) => candidate.id === commerce.selectedId);
    if (product?.source === "demo-fixture") {
      setCommerce((current) => ({
        ...current,
        cartStatus: "preview",
        cartError: "",
        checkoutUrl: "",
      }));
      return;
    }
    if (product?.source !== "shopify" || !product.merchandiseId) return;
    setCommerce((current) => ({ ...current, cartStatus: "adding", cartError: "", checkoutUrl: "" }));
    try {
      const cart = await createShopifyCart(product.merchandiseId, 1, commerce.authMode);
      if (!cart?.checkoutUrl) throw new Error("Shopify did not return a checkout URL.");
      setCommerce((current) => ({ ...current, cartStatus: "added", cartError: "", checkoutUrl: cart.checkoutUrl }));
    } catch (error) {
      setCommerce((current) => ({
        ...current,
        cartStatus: "error",
        cartError: error?.message || "This item could not be added to your Shopify cart.",
        checkoutUrl: "",
      }));
    }
  };

  const saveSuggestion = async (suggestion, index) => {
    setSavingOutfit(index);
    try {
      await onSaveOutfit({ ...suggestion, anchorGarmentId: item.id });
      setSavedSuggestions((current) => [...current, index]);
    } catch (error) {
      setStyling((current) => ({ ...current, error: error?.message || "This outfit could not be saved." }));
    } finally {
      setSavingOutfit(null);
    }
  };

  const handleImageLoad = (event) => {
    samplingCanvasRef.current = buildSamplingCanvas(event.currentTarget);
    const extracted = extractPalette(event.currentTarget);
    setPalette([...new Set([...(item.palette || []), ...extracted])].slice(0, 5));
  };

  const handleImageClick = (event) => {
    if (!sampling || !samplingCanvasRef.current) return;
    const color = sampleImageColor(event.currentTarget, samplingCanvasRef.current, event);
    if (!color) {
      setSampleStatus("That spot is transparent—try directly on the garment.");
      return;
    }
    const targetField = sampling === "secondary" ? "secondaryColor" : "color";
    setDraft((current) => ({ ...current, [targetField]: color }));
    setPalette((current) => [color, ...current.filter((existing) => existing.toLowerCase() !== color.toLowerCase())].slice(0, 5));
    setSampleStatus(`Sampled ${color} as the ${sampling} color.`);
    setSampling(null);
  };

  const garmentArtwork = (
    <div
      className={`viewer-art${hasModeledImage ? " viewer-art-floating" : ""}${sampling ? " sampling" : ""}`}
      style={hasModeledImage ? { "--piece-rotation": pieceRotation } : undefined}
    >
      <OptimizedImage
        ref={imageRef}
        src={item.image}
        alt={`Selected ${type.toLowerCase()}`}
        sizes="(max-width: 520px) 40vw, 300px"
        breakpoints={[160, 240, 320, 480, 640]}
        priority
        onLoad={handleImageLoad}
        onClick={handleImageClick}
      />
      {sampling && <span className="sample-hint">Click garment to sample</span>}
    </div>
  );

  return (
    <div className="viewer-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
    <div className="viewer-entry">
    <aside className={`viewer editing${hasModeledImage ? " has-modeled-image" : ""}${shaking ? " shake" : ""}`} role="dialog" aria-modal="true" aria-label="Selected wardrobe item">
      <button className="viewer-icon-close" type="button" onClick={requestClose} aria-label="Close viewer" ref={closeButtonRef}>
        <X size={24} weight="light" aria-hidden="true" />
      </button>

      {hasModeledImage ? (
        <div className="modeled-hero">
          <OptimizedImage
            className="modeled-hero-photo"
            src={item.modeledImage}
            alt={`${draft.name || type} worn by a model`}
            sizes="(max-width: 860px) 100vw, 520px"
            breakpoints={[320, 480, 640, 800, 1040, 1280]}
            quality={82}
            priority
          />
          <div className="viewer-heading modeled-heading">
            <div>
              <h2>{draft.name || TYPE_MAP[draft.part]?.singular}</h2>
            </div>
          </div>
          {garmentArtwork}
        </div>
      ) : (
        <>
          <div className="viewer-heading">
            <div>
              <h2>{draft.name || TYPE_MAP[draft.part]?.singular}</h2>
            </div>
          </div>
          {garmentArtwork}
        </>
      )}

      <div className="viewer-details editing">
        <div className="wardrobe-intelligence">
          {appearanceCount > 0 && <p className="appearance-count">Seen in {appearanceCount} {appearanceCount === 1 ? "photo" : "photos"}</p>}
          <button className="style-this-button" type="button" onClick={styleThis} disabled={styling.status === "loading"}>
            {styling.status === "loading" ? "Styling…" : "Style this"}
          </button>
        </div>

        {styling.status === "ready" && (
          <div className="style-suggestions" aria-label="Outfit suggestions">
            {styling.outfits.map((outfit, index) => (
              <article key={`${outfit.name}-${index}`}>
                <div className="style-suggestion-heading">
                  <div><span className="style-kind">Owned look · Owned {outfit.garmentIds.length}/{outfit.garmentIds.length}</span><h3>{outfit.name}</h3><p>{outfit.occasion}</p></div>
                  <button type="button" onClick={() => saveSuggestion(outfit, index)} disabled={savingOutfit === index || savedSuggestions.includes(index)}>
                    {savedSuggestions.includes(index) ? "Saved" : savingOutfit === index ? "Saving" : "Save outfit"}
                  </button>
                </div>
                <p>{outfit.reason}</p>
                <div className="style-suggestion-garments">
                  {outfit.garmentIds.map((id) => items.find((candidate) => candidate.id === id)).filter(Boolean).map((garment) => (
                    <span key={garment.id}>{garment.name}</span>
                  ))}
                </div>
              </article>
            ))}
            {styling.gap && (
              <article className="complete-look">
                <div className="complete-look-heading">
                  <div>
                    <span className="style-kind">Suggested addition</span>
                    <h3>Complete the look</h3>
                  </div>
                </div>
                <strong className="gap-product-name">{styling.gap.description}</strong>
                <p className="gap-impact">
                  <span>Would complement</span>
                  <strong>{styling.gap.compatibleWardrobeItemIds.length} pieces already in your wardrobe</strong>
                </p>
                <div className="gap-works-with">
                  <span>Works with</span>
                  <div>
                    {styling.gap.compatibleWardrobeItemIds
                      .map((id) => items.find((candidate) => candidate.id === id))
                      .filter(Boolean)
                      .slice(0, 4)
                      .map((garment) => <small key={garment.id}>{garment.name}</small>)}
                  </div>
                </div>
                <button className="shop-gap-button" type="button" onClick={shopGap} disabled={commerce.status === "loading"}>
                  {commerce.status === "loading" ? "Searching Shopify…" : commerce.products.length ? "Refresh Shopify picks" : "Shop this gap"}
                </button>

                {commerce.status === "ready" && (
                  <div className="shopify-results">
                    <p>{usingDemoCommerceFixtures ? "Armoire commerce preview" : "Recommended from Shopify"}</p>
                    <div className="shopify-product-list">
                      {commerce.products.map((product) => (
                        <button
                          className="shopify-product"
                          data-selected={commerce.selectedId === product.id}
                          type="button"
                          key={product.id}
                          onClick={() => selectProduct(product.id)}
                          aria-pressed={commerce.selectedId === product.id}
                        >
                          <span className="shopify-product-image">
                            {product.imageUrl
                              ? <OptimizedImage src={product.imageUrl} alt={product.imageAlt || product.title} sizes="110px" breakpoints={[110, 220]} />
                              : <span aria-hidden="true">No image</span>}
                          </span>
                          <span className="shopify-product-copy">
                            <strong>{product.title}</strong>
                            <small>{formatMoney(product.price, product.currencyCode)}</small>
                          </span>
                        </button>
                      ))}
                    </div>
                    {commerce.selectedId && commerce.cartStatus !== "added" && (
                      <button className="add-cart-button" type="button" onClick={addSelectedProduct} disabled={commerce.cartStatus === "adding"}>
                        {selectedCommerceProduct?.source === "demo-fixture"
                          ? "View Shopify integration"
                          : commerce.cartStatus === "adding"
                            ? "Adding…"
                            : commerce.cartStatus === "error"
                              ? "Try add to cart again"
                              : "Add to cart"}
                      </button>
                    )}
                    {commerce.cartStatus === "preview" && (
                      <p className="commerce-message integration-preview" role="status">
                        Live product search and cart checkout connect here when the Headless catalog is available.
                      </p>
                    )}
                    {commerce.cartError && <p className="commerce-message error" role="alert">{commerce.cartError}</p>}
                    {commerce.cartStatus === "added" && (
                      <div className="commerce-success" role="status">
                        <p>Added to your Shopify cart</p>
                        <button type="button" onClick={() => window.open(commerce.checkoutUrl, "_blank", "noopener,noreferrer")}>Checkout</button>
                      </div>
                    )}
                  </div>
                )}
                {commerce.error && <p className="commerce-message error" role="alert">{commerce.error}</p>}
              </article>
            )}
            {styling.gapError && <p className="commerce-message error" role="status">Complete the Look is temporarily unavailable: {styling.gapError}</p>}
          </div>
        )}
        {styling.error && <p className="unsaved-notice style-error" role="alert">{styling.error} <button type="button" onClick={styleThis}>Try again</button></p>}

        <ItemEditor
          draft={draft}
          setDraft={setDraft}
          palette={palette}
          sampling={sampling}
          setSampling={setSampling}
          sampleStatus={sampleStatus}
        />

        {closeBlocked && <p className="unsaved-notice" role="status">Save or cancel changes before closing.</p>}
        {mutationError && <p className="unsaved-notice" role="alert">{mutationError}</p>}

        <div className="viewer-actions" aria-busy={mutation !== "idle"}>
          {!item.demoFixture && <button className="delete-button" type="button" onClick={deleteEditing} disabled={mutation !== "idle"}>
            <Trash size={15} weight="regular" aria-hidden="true" /> {mutation === "deleting" ? "Deleting" : "Delete"}
          </button>}
          <span className="action-spacer" />
          <button className="secondary-button" type="button" onClick={cancelEditing} disabled={mutation !== "idle"}>Cancel</button>
          <button className="primary-button" type="button" onClick={saveEditing} disabled={mutation !== "idle" || !isDirty || !draft.name.trim()}>
            <Check size={15} weight="bold" aria-hidden="true" /> {mutation === "saving" ? "Saving" : "Save"}
          </button>
        </div>
      </div>
    </aside>
    </div>
    </div>
  );
}

export function App() {
  const [auth, setAuth] = useState({ status: "checking", user: null, error: "" });
  const [items, setItems] = useState([]);
  const [outfits, setOutfits] = useState([]);
  const [appearances, setAppearances] = useState([]);
  const [activeType, setActiveType] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [selectedOutfitId, setSelectedOutfitId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [seedState, setSeedState] = useState("idle");
  const [error, setError] = useState("");
  const [loadVersion, setLoadVersion] = useState(0);
  const [addingTestItem, setAddingTestItem] = useState(false);

  useEffect(() => {
    let active = true;
    getCurrentUser()
      .then((user) => {
        if (!active) return;
        setAuth(user
          ? { status: "authenticated", user, error: "" }
          : { status: "unauthenticated", user: null, error: "" });
      })
      .catch((requestError) => {
        if (active) setAuth({ status: "unauthenticated", user: null, error: requestError?.message || "Authentication could not be checked." });
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (auth.status !== "authenticated") return undefined;
    let active = true;
    setLoading(true);
    setError("");
    Promise.all([listWardrobeItems(), listOutfits(), listWardrobeAppearances()])
      .then(async ([loadedItems, loadedOutfits, loadedAppearances]) => {
        if (!active) return;
        setItems(loadedItems);
        setOutfits(loadedOutfits);
        setAppearances(loadedAppearances);
        const isDemoAccount = auth.user?.email?.trim().toLowerCase() === DEMO_EMAIL;
        const demoFixtures = loadedItems.filter((item) => item.demoFixture);
        const seedIsCurrent = demoFixtures.length === DEMO_ITEM_COUNT
          && demoFixtures.every((item) => item.demoSeedVersion === DEMO_SEED_VERSION);
        if (!isDemoAccount || seedIsCurrent) {
          setSeedState("ready");
          return;
        }
        setSeedState("preparing");
        await prepareDemoWardrobe();
        const prepared = await Promise.all([listWardrobeItems(), listOutfits(), listWardrobeAppearances()]);
        if (!active) return;
        setItems(prepared[0]);
        setOutfits(prepared[1]);
        setAppearances(prepared[2]);
        setSeedState("ready");
      })
      .catch((requestError) => {
        if (active) {
          setSeedState("error");
          setError(requestError?.response?.data?.error || requestError?.message || "Could not load the wardrobe.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [auth.status, auth.user?.email, loadVersion]);

  const selectedItem = items.find((item) => item.id === selectedId) || null;
  const selectedOutfit = outfits.find((outfit) => outfit.id === selectedOutfitId) || null;
  const itemMap = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const appearanceCounts = useMemo(() => appearances.reduce((counts, appearance) => {
    if (appearance.wardrobeItemId) counts.set(appearance.wardrobeItemId, (counts.get(appearance.wardrobeItemId) || 0) + 1);
    return counts;
  }, new Map()), [appearances]);

  const visibleItems = useMemo(() => {
    const filtered = activeType === "all" ? items : items.filter((item) => item.part === activeType);
    return [...filtered].sort((a, b) => {
      if (activeType === "all") {
        const typeDifference = (TYPE_ORDER[a.part] ?? 99) - (TYPE_ORDER[b.part] ?? 99);
        if (typeDifference) return typeDifference;
      }
      const orderDifference = (a.fixtureOrder ?? Number.MAX_SAFE_INTEGER) - (b.fixtureOrder ?? Number.MAX_SAFE_INTEGER);
      return orderDifference || a.id.localeCompare(b.id);
    });
  }, [activeType, items]);

  const visibleOutfits = useMemo(() => outfits
    .filter((outfit) => outfit.status !== "archived" && outfit.garmentIds.every((id) => itemMap.has(id)))
    .sort((a, b) => Number(b.demoFixture) - Number(a.demoFixture) || a.name.localeCompare(b.name)), [itemMap, outfits]);

  const chooseType = (typeId) => {
    setActiveType(typeId);
    setSelectedId(null);
    setSelectedOutfitId(null);
  };

  const saveItem = async (updatedItem) => {
    const savedItem = await updateWardrobeItem(updatedItem.id, updatedItem);
    setItems((current) => current.map((item) => item.id === savedItem.id ? savedItem : item));
    return savedItem;
  };

  const deleteItem = async (id) => {
    const item = items.find((candidate) => candidate.id === id);
    await deleteWardrobeItem(id);
    setItems((current) => current.filter((candidate) => candidate.id !== id));
    setSelectedId(null);

    if (item?.importJobId) {
      try {
        const response = await fetch(`/api/import/wardrobe/import-${item.importJobId}`, { method: "DELETE" });
        if (!response.ok && response.status !== 404) throw new Error("Could not delete the imported item.");
      } catch (requestError) {
        setError(`${requestError.message} The private Base44 record was deleted.`);
      }
    }
  };

  const addTestItem = async () => {
    setAddingTestItem(true);
    setError("");
    try {
      const createdItem = await createWardrobeItem(DEV_TEST_ITEM);
      setItems((current) => [...current, createdItem]);
      setActiveType("all");
    } catch (requestError) {
      setError(requestError?.message || "Could not add the test item.");
    } finally {
      setAddingTestItem(false);
    }
  };

  const refreshWardrobeAfterImport = async () => {
    const [loadedItems, loadedAppearances] = await Promise.all([listWardrobeItems(), listWardrobeAppearances()]);
    setItems(loadedItems);
    setAppearances(loadedAppearances);
    setActiveType("all");
  };

  const saveStyledOutfit = async (suggestion) => {
    const created = await saveOutfit(suggestion, items.map((item) => item.id));
    setOutfits((current) => [...current, created]);
    return created;
  };

  const deleteSavedOutfit = async (id) => {
    await deleteOutfit(id);
    setOutfits((current) => current.filter((outfit) => outfit.id !== id));
    setSelectedOutfitId(null);
  };

  if (auth.status === "checking") {
    return (
      <main className="auth-shell auth-checking" aria-busy="true">
        <p className="auth-eyebrow">Armoire</p>
        <p className="auth-checking-copy">Opening your private wardrobe</p>
      </main>
    );
  }

  if (auth.status === "unauthenticated") {
    return <AuthScreen initialError={auth.error} onAuthenticated={(user) => setAuth({ status: "authenticated", user, error: "" })} />;
  }

  return (
    <div className={`app-shell${selectedItem || selectedOutfit ? " has-selection" : ""}`}>
      <main className="gallery-pane">
        <header className="gallery-header">
          <div className="gallery-meta-row">
            <div className="gallery-summary">
              <p className="piece-count">{items.length} {items.length === 1 ? "piece" : "pieces"}</p>
              {import.meta.env.DEV && (
                <button
                  className="dev-add-test-item"
                  type="button"
                  onClick={addTestItem}
                  disabled={addingTestItem}
                  aria-busy={addingTestItem}
                >
                  <Plus size={13} weight="regular" aria-hidden="true" />
                  {addingTestItem ? "Adding" : "Add test item"}
                </button>
              )}
            </div>
            <div className="account-controls">
              <span>{auth.user?.email}</span>
              <button type="button" onClick={logout}>Sign out</button>
            </div>
          </div>
          <nav className="category-nav" aria-label="Filter wardrobe by item type">
            {NAV_TYPES.map((type) => (
              <button
                key={type.id}
                type="button"
                className={activeType === type.id ? "active" : ""}
                onClick={() => chooseType(type.id)}
                aria-pressed={activeType === type.id}
              >
                {type.label}
              </button>
            ))}
          </nav>
        </header>

        {error && <p className="status error">{error} <button type="button" onClick={() => setLoadVersion((current) => current + 1)}>Try again</button></p>}
        {!error && loading && <p className="status">{seedState === "preparing" ? "Preparing your wardrobe…" : "Loading wardrobe"}</p>}
        {!error && !loading && !items.length && <p className="status empty">Drop, paste, or add a photo to import your first piece.</p>}
        {!error && !loading && activeType === "outfits" && !visibleOutfits.length && <p className="status empty">Style a piece to save your first outfit.</p>}

        {!!items.length && activeType !== "outfits" && (
          <section className="gallery-grid" aria-label={`${TYPE_MAP[activeType]?.label || "All"} wardrobe items`}>
            {visibleItems.map((item) => (
              <GalleryItem
                key={item.id}
                item={item}
                selected={selectedId === item.id}
                onOpen={setSelectedId}
              />
            ))}
          </section>
        )}
        {activeType === "outfits" && !!visibleOutfits.length && <OutfitGallery outfits={visibleOutfits} itemMap={itemMap} onOpen={setSelectedOutfitId} />}
      </main>

      {selectedItem && <ItemViewer
        item={selectedItem}
        items={items}
        appearanceCount={appearanceCounts.get(selectedItem.id) || 0}
        isDemoAccount={auth.user?.email?.trim().toLowerCase() === DEMO_EMAIL}
        onClose={() => setSelectedId(null)}
        onSave={saveItem}
        onDelete={deleteItem}
        onStyle={styleWardrobeItem}
        onSaveOutfit={saveStyledOutfit}
      />}
      {selectedOutfit && <OutfitViewer outfit={selectedOutfit} itemMap={itemMap} onClose={() => setSelectedOutfitId(null)} onDelete={deleteSavedOutfit} />}
      <WardrobeImportFlow onWardrobeChanged={refreshWardrobeAfterImport} />
    </div>
  );
}
