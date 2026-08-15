import { useEffect, useRef } from "react";
import { Trash, X } from "@phosphor-icons/react";
import { OptimizedImage } from "./OptimizedImage.jsx";

const PART_CLASS = {
  upperbody: "top",
  wholebody_up: "outerwear",
  lowerbody: "bottom",
  accessories_up: "accessory",
  shoes: "shoes",
};

export function OutfitComposition({ outfit, itemMap, compact = false }) {
  const garments = outfit.garmentIds.map((id) => itemMap.get(id)).filter(Boolean);
  return (
    <div className={`outfit-composition${compact ? " is-compact" : ""}`} aria-hidden="true">
      {garments.map((item) => (
        <OptimizedImage
          className={`outfit-piece is-${PART_CLASS[item.part] || "other"}`}
          key={item.id}
          src={item.thumbnail || item.image}
          alt=""
          sizes={compact ? "140px" : "240px"}
          breakpoints={compact ? [100, 140, 180, 240] : [160, 240, 320, 480]}
        />
      ))}
    </div>
  );
}

export function OutfitGallery({ outfits, itemMap, onOpen }) {
  return (
    <section className="outfit-grid" aria-label="Saved outfits">
      {outfits.map((outfit) => (
        <button className="outfit-tile" type="button" key={outfit.id} onClick={() => onOpen(outfit.id)}>
          <OutfitComposition outfit={outfit} itemMap={itemMap} />
          <span className="outfit-tile-copy">
            <strong>{outfit.name}</strong>
            {outfit.occasion && <small>{outfit.occasion}</small>}
          </span>
        </button>
      ))}
    </section>
  );
}

export function OutfitViewer({ outfit, itemMap, onClose, onDelete }) {
  const closeButtonRef = useRef(null);
  const garments = outfit.garmentIds.map((id) => itemMap.get(id)).filter(Boolean);

  useEffect(() => {
    const onKeyDown = (event) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKeyDown);
    document.body.classList.add("viewer-open");
    closeButtonRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("viewer-open");
    };
  }, [onClose]);

  return (
    <div className="viewer-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="viewer-entry">
        <aside className="viewer outfit-viewer" role="dialog" aria-modal="true" aria-label={outfit.name}>
          <button className="viewer-icon-close" type="button" onClick={onClose} aria-label="Close outfit" ref={closeButtonRef}>
            <X size={24} weight="light" aria-hidden="true" />
          </button>
          <div className="outfit-viewer-heading">
            <p>Saved outfit</p>
            <h2>{outfit.name}</h2>
            {outfit.occasion && <span>{outfit.occasion}</span>}
          </div>
          <OutfitComposition outfit={outfit} itemMap={itemMap} compact />
          <div className="outfit-garment-list">
            {garments.map((item) => (
              <div key={item.id}>
                <OptimizedImage src={item.thumbnail || item.image} alt="" sizes="58px" breakpoints={[58, 116]} />
                <span>{item.name}</span>
              </div>
            ))}
          </div>
          <div className="outfit-reason">
            <p>Why this works</p>
            <span>{outfit.reason}</span>
          </div>
          {!outfit.demoFixture && (
            <div className="viewer-actions">
              <button className="delete-button" type="button" onClick={() => onDelete(outfit.id)}>
                <Trash size={15} weight="regular" aria-hidden="true" /> Delete outfit
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
