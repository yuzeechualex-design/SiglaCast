import { useMemo, useRef, useState } from "react";
import { mediaUrl } from "../services/api.js";

function shopAssetUrl(url) {
  if (!url) return "";
  if (String(url).startsWith("/assets/")) return url;
  return mediaUrl(url);
}

function CoinIcon({ className = "" }) {
  return <img className={`coin-icon${className ? ` ${className}` : ""}`} src="/assets/purxu-coin.png" alt="" aria-hidden="true" />;
}

function CoinAmount({ value, suffix = "coins", className = "" }) {
  const n = Number(value) || 0;
  return (
    <span className={`coin-amount${className ? ` ${className}` : ""}`}>
      <CoinIcon />
      <strong>{n.toLocaleString()}</strong>
      {suffix ? <small>{suffix}</small> : null}
    </span>
  );
}

function PriceLabel({ value }) {
  const n = Number(value) || 0;
  if (n === 0) return <span className="coin-price-free">Free</span>;
  return <CoinAmount value={n} />;
}

const coinPackages = [
  { coins: 100, price: "$1.99", imageUrl: "/assets/purxu-coins-small.png" },
  { coins: 300, price: "$4.90", imageUrl: "/assets/purxu-coins-small.png" },
  { coins: 500, price: "$7.99", imageUrl: "/assets/purxu-coins-small.png" },
  { coins: 1000, price: "$16.40", imageUrl: "/assets/purxu-coins-large.png" },
  { coins: 5000, price: "$82.20", imageUrl: "/assets/purxu-coins-large.png" },
  { coins: 10000, price: "$164.40", imageUrl: "/assets/purxu-coins-large.png" }
];

function ShopSectionTitle({ children }) {
  return <h3 className="shop-section-title">{children}</h3>;
}

function BundleModal({ onClose }) {
  return (
    <div className="gacha-modal-backdrop" role="dialog" aria-modal="true" aria-label="Purxu monthly card bundle benefits">
      <div className="bundle-modal">
        <div className="gacha-modal-head">
          <div>
            <p>Monthly Bundle</p>
            <h3>Purxu Monthly Card Bundle</h3>
          </div>
          <button type="button" className="gacha-close-btn" onClick={onClose} aria-label="Close">
            x
          </button>
        </div>
        <img className="bundle-modal-art" src="/assets/purxu-monthly-card-bundle.png" alt="" />
        <div className="bundle-benefits">
          <strong>Benefits</strong>
          <p>- get upto 900 coins in total</p>
          <p>- obtain 300 coins after purchase</p>
          <p>- you can claim 20 coins daily</p>
        </div>
        <div className="bundle-modal-footer">
          <strong>$9.69</strong>
          <button type="button" className="btn btn-primary" onClick={onClose}>Buy Bundle</button>
        </div>
      </div>
    </div>
  );
}

function GachaModal({ gacha, wallet, onClose, onDraw }) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [reward, setReward] = useState(null);
  const [pendingReward, setPendingReward] = useState(null);
  const [reelKey, setReelKey] = useState(0);
  const [reelStop, setReelStop] = useState("-58%");
  const [error, setError] = useState("");
  const stageRef = useRef(null);
  const availableCount = (gacha?.pool || []).filter((item) => !item.owned).length;
  const complete = availableCount === 0;
  const canAfford = (wallet?.coins ?? 0) >= (gacha?.nextCost ?? 0);
  const reelItems = useMemo(() => {
    const pool = gacha?.pool?.length ? gacha.pool : [];
    const visualPool = pool.length ? pool : [];
    const base = [...visualPool, ...visualPool, ...visualPool, ...visualPool, ...visualPool];
    const target = pendingReward || reward;
    if (!target || !visualPool.length) return base.slice(0, 40);
    const rewardIndex = visualPool.findIndex((item) => item.id === target.id);
    if (rewardIndex < 0) return base.slice(0, 40);
    const landingIndex = visualPool.length * 3 + rewardIndex;
    return base.slice(0, Math.max(landingIndex + visualPool.length, 32));
  }, [gacha?.pool, pendingReward, reward]);

  function calculateReelStop(target) {
    const pool = gacha?.pool?.length ? gacha.pool : [];
    const rewardIndex = pool.findIndex((item) => item.id === target?.id);
    if (rewardIndex < 0) return "-58%";
    const stageWidth = stageRef.current?.getBoundingClientRect?.().width || 900;
    const tileWidth = 96;
    const gap = 14;
    const pad = 24;
    const landingIndex = pool.length * 3 + rewardIndex;
    const tileCenter = pad + landingIndex * (tileWidth + gap) + tileWidth / 2;
    return `${Math.round(stageWidth / 2 - tileCenter)}px`;
  }

  async function draw() {
    if (!gacha?.id || drawing || complete) return;
    setError("");
    setReward(null);
    setPendingReward(null);
    const res = await onDraw?.(gacha.id);
    if (!res || res.error) {
      setError(res?.error || "Draw failed. Try again.");
      setDrawing(false);
      return;
    }
    setPendingReward(res.reward);
    setReelStop(calculateReelStop(res.reward));
    setReelKey((key) => key + 1);
    window.requestAnimationFrame(() => setDrawing(true));
    window.setTimeout(() => {
      setDrawing(false);
      setReward(res.reward);
      setPendingReward(null);
    }, 5000);
  }

  return (
    <div className="gacha-modal-backdrop" role="dialog" aria-modal="true" aria-label={`${gacha?.name || "Limited"} gacha`}>
      <div className="gacha-modal">
        <div className="gacha-modal-head">
          <div>
            <p>Limited Collection</p>
            <h3>{gacha?.name || "Alien Stage Frames"}</h3>
          </div>
          <div className="gacha-head-actions">
            <button type="button" className="gacha-help-btn" onClick={() => setHelpOpen((v) => !v)} aria-label="How this works">
              ?
            </button>
            <button type="button" className="gacha-close-btn" onClick={onClose} aria-label="Close">
              x
            </button>
          </div>
        </div>

        {helpOpen ? (
          <div className="gacha-help-panel">
            <strong>How draws work</strong>
            <p>{gacha?.description || "Each draw gives one unowned reward, then removes it from the next draw pool."}</p>
          </div>
        ) : null}

        <div className="gacha-stage" ref={stageRef}>
          <div
            key={reelKey}
            className={`gacha-reel${drawing ? " is-drawing" : ""}`}
            style={{ "--gacha-reel-stop": reelStop }}
          >
            {reelItems.map((item, index) => (
              <div
                key={`${item.id}-${index}`}
                className={`gacha-reel-tile ${item.type === "profile_frame" ? "rare" : ""}${(pendingReward || reward)?.id === item.id ? " is-result" : ""}`}
              >
                <img src={shopAssetUrl(item.imageUrl)} alt="" />
              </div>
            ))}
          </div>
          <div className="gacha-focus-ring" aria-hidden />
          <div className="gacha-pointer" aria-hidden />
          <div className="gacha-win-indicator">
            {(reward || pendingReward) ? (
              <>
                <img src={shopAssetUrl((reward || pendingReward).imageUrl)} alt="" />
                {reward ? <span>You got</span> : null}
                <strong>{(reward || pendingReward).name}</strong>
              </>
            ) : (
              <span>Reward lands here</span>
            )}
          </div>
        </div>

        <div className="gacha-pool-grid">
          {(gacha?.pool || []).map((item) => (
            <div key={item.id} className={`gacha-pool-item ${item.owned ? "owned" : ""} ${item.type === "profile_frame" ? "rare" : ""}`}>
              <img src={shopAssetUrl(item.imageUrl)} alt="" />
              <span>{item.type === "profile_badge" ? "Badge" : "Frame"}</span>
              <strong>{item.name}</strong>
              <small>{item.owned ? "Owned" : item.chanceGroup}</small>
            </div>
          ))}
        </div>

        {reward ? (
          <div className={`gacha-result ${reward.type === "profile_frame" ? "rare" : ""}`}>
            <img src={shopAssetUrl(reward.imageUrl)} alt="" />
            <div>
              <span>You won</span>
              <strong>{reward.name}</strong>
            </div>
          </div>
        ) : null}
        {error ? <p className="form-error">{error}</p> : null}

        <div className="gacha-modal-footer">
          <div className="gacha-draw-info">
            <span>{availableCount} rewards left</span>
            <CoinAmount value={wallet?.coins ?? 0} />
          </div>
          <button type="button" className="btn btn-primary gacha-draw-btn" disabled={drawing || complete || !canAfford} onClick={draw}>
            {drawing ? "Drawing..." : complete ? "Complete" : (
              <>
                <span>Draw</span>
                <CoinAmount value={gacha?.nextCost ?? 0} suffix="" className="coin-amount-inline" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ShopPage({ wallet, items = [], gacha = null, gachas = [], currentUser, onBuy, onDrawGacha }) {
  const [activeTab, setActiveTab] = useState("cosmetics");
  const [selectedGacha, setSelectedGacha] = useState(null);
  const [bundleOpen, setBundleOpen] = useState(false);
  const limitedCollections = gachas.length ? gachas : (gacha ? [gacha] : []);
  const directItems = items.filter((item) => item.source !== "gacha_reward");
  const displayItems = directItems.length
    ? directItems
    : [
        {
          id: "pink-heart-bond-frame",
          name: "Pink Heart Bond Frame",
          type: "profile_frame",
          price: 20,
          imageUrl: "/assets/bond-frame-pink.png",
          description: "A glossy heart frame unlocked by reaching Partner Bond with someone.",
          owned: false,
          unlocked: false
        }
      ];
  const featured = displayItems[0] || null;
  const [previewItemId, setPreviewItemId] = useState(featured?.id || "");
  const previewItem = displayItems.find((item) => item.id === previewItemId) || featured;
  const avatarUrl = currentUser?.avatarUrl ? mediaUrl(currentUser.avatarUrl) : "/assets/purxu-shop-logo.png";
  const previewKey = useMemo(() => `${previewItem?.id || "empty"}-${Date.now()}`, [previewItem?.id]);

  return (
    <section className="shop-page">
      <div className="shop-topbar">
        <div>
          <p className="shop-eyebrow">purxu shop</p>
          <h2>Cosmetics</h2>
          <div className="shop-tabs" role="tablist" aria-label="Shop sections">
            {[
              ["cosmetics", "Cosmetics"],
              ["coins", "Coins Shop"],
              ["bundles", "Bundles"]
            ].map(([id, label]) => (
              <button key={id} type="button" className={activeTab === id ? "active" : ""} onClick={() => setActiveTab(id)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="shop-wallet">
          <CoinAmount value={wallet?.coins ?? 0} />
        </div>
      </div>

      {activeTab === "cosmetics" ? (
        <>
          <ShopSectionTitle>Limited Cosmetics</ShopSectionTitle>
          <div className="shop-limited-grid">
            {limitedCollections.map((collection) => (
              <button key={collection.id} type="button" className="shop-gacha-banner" onClick={() => setSelectedGacha(collection)}>
                <img src={shopAssetUrl(collection.bannerUrl)} alt="" />
                <span className="shop-gacha-banner-shade" aria-hidden />
                <span className="shop-gacha-banner-copy">
                  <small>Gacha Collection</small>
                  <strong>{collection.name}</strong>
                  <em>{collection.description}</em>
                </span>
                <span className="shop-gacha-banner-cta">
                  Draw <CoinAmount value={collection.nextCost} suffix="" className="coin-amount-inline" />
                </span>
              </button>
            ))}
          </div>

          <ShopSectionTitle>Purchasable</ShopSectionTitle>
          <div className="shop-hero">
            <div>
              <p>Featured Collection</p>
              <h3>Heart Bond Frames</h3>
              <span>Click a frame to preview the animation with your profile icon before buying.</span>
            </div>
            {previewItem ? (
              <div key={previewKey} className="shop-profile-preview animated">
                <img className="shop-preview-frame" src={shopAssetUrl(previewItem.imageUrl)} alt="" />
                <img className="shop-preview-avatar" src={avatarUrl} alt="" />
              </div>
            ) : null}
          </div>

          <div className="shop-grid">
            {displayItems.map((item) => (
              <article key={item.id} className={`shop-card ${item.owned ? "owned" : ""} ${previewItem?.id === item.id ? "active" : ""}`}>
                <button type="button" className="shop-card-art" onClick={() => setPreviewItemId(item.id)}>
                  <div className="shop-card-preview">
                    <img className="shop-card-frame" src={shopAssetUrl(item.imageUrl)} alt="" />
                    <img className="shop-card-logo" src="/assets/purxu-shop-logo.png" alt="" />
                  </div>
                </button>
                <div className="shop-card-body">
                  <span>{item.type?.replace(/_/g, " ")}</span>
                  <h3>{item.name}</h3>
                  <p>{item.description}</p>
                  <div className="shop-card-footer">
                    <PriceLabel value={item.effectivePrice ?? item.price} />
                    <button type="button" className="btn btn-primary" disabled={item.owned || !item.unlocked} onClick={() => onBuy?.(item.id)}>
                      {item.owned ? "Owned" : item.unlocked ? "Buy" : "Locked"}
                    </button>
                  </div>
                  {!item.unlocked ? <small className="shop-lock-note">Reach Partner Bond Level first.</small> : null}
                </div>
              </article>
            ))}
          </div>
        </>
      ) : null}

      {activeTab === "coins" ? (
        <>
          <ShopSectionTitle>Coins Shop</ShopSectionTitle>
          <div className="coin-shop-grid">
            {coinPackages.map((pack) => (
              <article key={pack.coins} className="coin-shop-card">
                <img src={pack.imageUrl} alt="" />
                <div>
                  <CoinAmount value={pack.coins} />
                  <strong>{pack.price} usd</strong>
                </div>
                <button type="button" className="btn btn-primary">Purchase</button>
              </article>
            ))}
          </div>
        </>
      ) : null}

      {activeTab === "bundles" ? (
        <>
          <ShopSectionTitle>Bundles</ShopSectionTitle>
          <div className="bundle-grid">
            <button type="button" className="bundle-card" onClick={() => setBundleOpen(true)}>
              <img src="/assets/purxu-monthly-card-bundle.png" alt="" />
              <span>
                <small>Monthly Bundle</small>
                <strong>Purxu Monthly Card Bundle</strong>
                <em>$9.69</em>
              </span>
            </button>
          </div>
        </>
      ) : null}

      {selectedGacha ? (
        <GachaModal
          gacha={selectedGacha}
          wallet={wallet}
          onClose={() => setSelectedGacha(null)}
          onDraw={async (collectionId) => {
            const res = await onDrawGacha?.(collectionId);
            if (res?.gacha) setSelectedGacha(res.gacha);
            return res;
          }}
        />
      ) : null}
      {bundleOpen ? <BundleModal onClose={() => setBundleOpen(false)} /> : null}
    </section>
  );
}
