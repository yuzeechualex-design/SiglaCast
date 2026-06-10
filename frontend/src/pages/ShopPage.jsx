import { mediaUrl } from "../services/api.js";

export default function ShopPage({ wallet, items = [], onBuy }) {
  const featured = items[0];

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
          <span>Unlock Partner Bond, earn coins by chatting, then buy profile cosmetics here.</span>
        </div>
        {featured ? <img src={mediaUrl(featured.imageUrl)} alt="" /> : null}
      </div>

      <div className="shop-grid">
        {items.map((item) => (
          <article key={item.id} className={`shop-card ${item.owned ? "owned" : ""}`}>
            <div className="shop-card-art">
              <img src={mediaUrl(item.imageUrl)} alt="" />
            </div>
            <div className="shop-card-body">
              <span>{item.type?.replace(/_/g, " ")}</span>
              <h3>{item.name}</h3>
              <p>{item.description}</p>
              <div className="shop-card-footer">
                <strong>◆ {item.price}</strong>
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
