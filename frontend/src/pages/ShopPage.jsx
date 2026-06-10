import { useMemo, useState } from "react";
import { mediaUrl } from "../services/api.js";

export default function ShopPage({ wallet, items = [], currentUser, onBuy }) {
  const featured = items[0] || null;
  const [previewItemId, setPreviewItemId] = useState(featured?.id || "");
  const previewItem = items.find((item) => item.id === previewItemId) || featured;
  const avatarUrl = currentUser?.avatarUrl ? mediaUrl(currentUser.avatarUrl) : "/assets/purxu-shop-logo.png";
  const previewKey = useMemo(() => `${previewItem?.id || "empty"}-${Date.now()}`, [previewItem?.id]);

  return (
    <section className="shop-page">
      <div className="shop-topbar">
        <div>
          <p className="shop-eyebrow">purxu shop</p>
          <h2>Bond cosmetics</h2>
        </div>
        <div className="shop-wallet">
          <span>◆</span>
          <strong>{wallet?.coins ?? 0}</strong>
          <small>coins</small>
        </div>
      </div>

      <div className="shop-hero">
        <div>
          <p>Featured Collection</p>
          <h3>Heart Bond Frames</h3>
          <span>Click a frame to preview the animation with your profile icon before buying.</span>
        </div>
        {previewItem ? (
          <div key={previewKey} className="shop-profile-preview animated">
            <img className="shop-preview-frame" src={mediaUrl(previewItem.imageUrl)} alt="" />
            <img className="shop-preview-avatar" src={avatarUrl} alt="" />
          </div>
        ) : null}
      </div>

      <div className="shop-grid">
        {items.map((item) => (
          <article key={item.id} className={`shop-card ${item.owned ? "owned" : ""} ${previewItem?.id === item.id ? "active" : ""}`}>
            <button type="button" className="shop-card-art" onClick={() => setPreviewItemId(item.id)}>
              <div className="shop-card-preview">
                <img className="shop-card-frame" src={mediaUrl(item.imageUrl)} alt="" />
                <img className="shop-card-logo" src="/assets/purxu-shop-logo.png" alt="" />
              </div>
            </button>
            <div className="shop-card-body">
              <span>{item.type?.replace(/_/g, " ")}</span>
              <h3>{item.name}</h3>
              <p>{item.description}</p>
              <div className="shop-card-footer">
                <strong>{item.price} coins</strong>
                <button type="button" className="btn btn-primary" disabled={item.owned || !item.unlocked} onClick={() => onBuy?.(item.id)}>
                  {item.owned ? "Owned" : item.unlocked ? "Buy" : "Locked"}
                </button>
              </div>
              {!item.unlocked ? <small className="shop-lock-note">Reach Partner Bond Level first.</small> : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
