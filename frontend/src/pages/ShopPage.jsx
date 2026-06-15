import { useEffect, useMemo, useRef, useState } from "react";
import { API_ORIGIN, mediaUrl } from "../services/api.js";

function shopAssetUrl(url) {
  if (!url) return "";
  if (String(url).startsWith("/assets/")) return url;
  return mediaUrl(url);
}

function isVideoAsset(url) {
  return /\.(mp4|webm|mov)(\?|#|$)/i.test(String(url || ""));
}

function ShopMedia({ src, className = "", alt = "" }) {
  const url = shopAssetUrl(src);
  if (!url) return null;
  if (isVideoAsset(url)) {
    return (
      <video className={className} autoPlay muted loop playsInline preload="metadata" aria-label={alt || undefined}>
        <source src={url} type="video/mp4" />
      </video>
    );
  }
  return <img className={className} src={url} alt={alt} />;
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

function KeyAmount({ value, suffix = "keys", className = "" }) {
  const n = Number(value) || 0;
  return (
    <span className={`key-amount${className ? ` ${className}` : ""}`}>
      <img className="key-icon" src="/assets/exe-key.png" alt="" aria-hidden="true" />
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
  { sku: "coins_100", coins: 100, price: "$1.99", imageUrl: "/assets/purxu-coins-small.png" },
  { sku: "coins_300", coins: 300, price: "$4.90", imageUrl: "/assets/purxu-coins-small.png" },
  { sku: "coins_500", coins: 500, price: "$7.99", imageUrl: "/assets/purxu-coins-small.png" },
  { sku: "coins_1000", coins: 1000, price: "$16.40", imageUrl: "/assets/purxu-coins-large.png" },
  { sku: "coins_5000", coins: 5000, price: "$82.20", imageUrl: "/assets/purxu-coins-large.png" },
  { sku: "coins_10000", coins: 10000, price: "$164.40", imageUrl: "/assets/purxu-coins-large.png" }
];

function paypalSdkUrl(clientId) {
  return `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&components=buttons&enable-funding=card&disable-funding=venmo,paylater`;
}

function waitForPaypal(timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    if (window.paypal?.Buttons) return resolve(window.paypal);
    const start = Date.now();
    const interval = setInterval(() => {
      if (window.paypal?.Buttons) {
        clearInterval(interval);
        resolve(window.paypal);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(new Error("PayPal checkout took too long to load. Check the client ID and network."));
      }
    }, 200);
  });
}

function loadPayPalSdk(clientId) {
  if (window.paypal?.Buttons) return Promise.resolve(window.paypal);
  const existing = document.querySelector("script[data-purxu-paypal-sdk='1']");
  if (existing) {
    if (existing.dataset.failed === "1") {
      existing.remove();
    } else {
      // Script exists and is either loading or loaded — poll for window.paypal
      return waitForPaypal();
    }
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => {
      script.dataset.failed = "1";
      reject(new Error("PayPal checkout took too long to load. Check the client ID and network."));
    }, 12000);
    script.src = paypalSdkUrl(clientId);
    script.async = true;
    script.dataset.purxuPaypalSdk = "1";
    script.onload = () => {
      window.clearTimeout(timeout);
      script.dataset.loaded = "1";
      if (window.paypal?.Buttons) resolve(window.paypal);
      else reject(new Error("PayPal checkout loaded, but buttons are unavailable."));
    };
    script.onerror = () => {
      window.clearTimeout(timeout);
      script.dataset.failed = "1";
      reject(new Error("Could not load PayPal checkout."));
    };
    document.head.appendChild(script);
  });
}

const fallbackChiikawaGacha = {
  id: "chiikawa-frame",
  name: "Chiikawa Frames",
  bannerUrl: "/assets/chiikawa-banner-animation.mp4",
  description: "Draw once for 300 coins to win one unowned Chiikawa profile frame. Won frames leave the pool.",
  nextCost: 300,
  pool: [
    { id: "chiikawa-hachiware-frame", name: "Hachiware Profile Frame", type: "profile_frame", imageUrl: "/assets/chiikawa-hachiware-frame.png", chanceGroup: "Equal chance" },
    { id: "chiikawa-usagi-frame", name: "Usagi Profile Frame", type: "profile_frame", imageUrl: "/assets/chiikawa-usagi-frame.png", chanceGroup: "Equal chance" },
    { id: "chiikawa-momonga-frame", name: "Momonga Profile Frame", type: "profile_frame", imageUrl: "/assets/chiikawa-momonga-frame.png", chanceGroup: "Equal chance" },
    { id: "chiikawa-chiikawa-frame", name: "Chiikawa Profile Frame", type: "profile_frame", imageUrl: "/assets/chiikawa-chiikawa-frame.png", chanceGroup: "Equal chance" }
  ]
};

const fallbackExeGacha = {
  id: "exe-profile-card",
  name: "EXE Banner",
  bannerUrl: "/assets/exe-profile-background.mp4",
  description: "Profile card backgrounds, EXE frame, and keys. 300 coins per pull.",
  badgeText: "30 days left",
  nextCost: 300,
  pool: [
    { id: "exe-profile-background", name: "EXE Profile Card Background", type: "profile_card_background", imageUrl: "/assets/exe-profile-background.mp4", chanceGroup: "Featured reward" },
    { id: "exe-frame", name: "EXE Profile Frame", type: "profile_frame", imageUrl: "/assets/exe-frame.png", chanceGroup: "Rare" },
    { id: "exe-key-1", name: "1 Key", type: "gacha_key", imageUrl: "/assets/exe-key.png", chanceGroup: "Key reward" },
    { id: "exe-key-2", name: "2 Key", type: "gacha_key", imageUrl: "/assets/exe-key.png", chanceGroup: "Key reward" },
    { id: "exe-key-3", name: "3 Key", type: "gacha_key", imageUrl: "/assets/exe-key.png", chanceGroup: "Key reward" },
    { id: "exe-key-4", name: "4 Key", type: "gacha_key", imageUrl: "/assets/exe-key.png", chanceGroup: "Key reward" },
    { id: "exe-key-5", name: "5 Key", type: "gacha_key", imageUrl: "/assets/exe-key.png", chanceGroup: "Key reward" }
  ]
};

function ShopSectionTitle({ children }) {
  return <h3 className="shop-section-title">{children}</h3>;
}

function CheckoutModal({ product, onClose, onCreateOrder, onCaptureOrder }) {
  const paypalRef = useRef(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const isMonthly = product?.kind === "monthly_card";

  // Stabilize callback refs so the effect doesn't re-trigger on every parent render
  const onCreateOrderRef = useRef(onCreateOrder);
  const onCaptureOrderRef = useRef(onCaptureOrder);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCreateOrderRef.current = onCreateOrder; }, [onCreateOrder]);
  useEffect(() => { onCaptureOrderRef.current = onCaptureOrder; }, [onCaptureOrder]);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    let rendered = null;
    (async () => {
      try {
        setStatus("loading");
        setError("");
        const configRes = await fetch(`${API_ORIGIN}/api/shop/paypal/config`, {
          headers: { Authorization: `Bearer ${localStorage.getItem("siglacast_token") || ""}` }
        });
        if (!configRes.ok) throw new Error("Could not fetch PayPal configuration.");
        const config = await configRes.json();
        if (!config.enabled || !config.clientId) throw new Error("PayPal is not configured yet.");
        const paypal = await loadPayPalSdk(config.clientId);
        if (cancelled || !paypalRef.current) return;
        paypalRef.current.innerHTML = "";
        rendered = paypal.Buttons({
          style: { layout: "vertical", shape: "pill", color: "blue", label: "pay" },
          createOrder: async () => {
            const res = await onCreateOrderRef.current?.(product.sku);
            if (res?.error) throw new Error(res.error);
            return res.orderId;
          },
          onApprove: async (data) => {
            setStatus("capturing");
            const res = await onCaptureOrderRef.current?.(data.orderID);
            if (res?.error) {
              setError(res.error);
              setStatus("ready");
              return;
            }
            setStatus("success");
            window.setTimeout(() => onCloseRef.current?.(), 1100);
          },
          onError: (err) => {
            setError(err?.message || "Payment failed. Please try again.");
            setStatus("ready");
          },
          onCancel: () => setStatus("ready")
        });
        await rendered.render(paypalRef.current);
        if (!cancelled) setStatus("ready");
      } catch (e) {
        if (!cancelled) {
          setError(e.message || "Could not start checkout.");
          setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
      try { rendered?.close?.(); } catch (_) { /* ignore */ }
    };
  }, [product?.sku]);

  return (
    <div className="gacha-modal-backdrop" role="dialog" aria-modal="true" aria-label="Complete purchase">
      <div className="bundle-modal">
        <div className="gacha-modal-head">
          <div>
            <p>{isMonthly ? "Monthly Bundle" : "Coin Pack"}</p>
            <h3>{product?.title || "Purchase"}</h3>
          </div>
          <button type="button" className="gacha-close-btn" onClick={onClose} aria-label="Close">
            x
          </button>
        </div>
        <img className="bundle-modal-art" src={product?.imageUrl || "/assets/purxu-monthly-card-bundle.png"} alt="" />
        <div className="bundle-benefits">
          <strong>{product?.price} USD</strong>
          {isMonthly ? (
            <>
              <p>- claim 300 coins immediately</p>
              <p>- claim 20 coins daily for 30 days</p>
              <p>- daily claim popup appears while active</p>
            </>
          ) : (
            <p>- {product?.coins?.toLocaleString()} coins will be added after payment is captured</p>
          )}
        </div>
        <div className="checkout-paypal-panel">
          <div ref={paypalRef} />
          {status === "loading" ? <p className="muted small">Loading secure checkout...</p> : null}
          {status === "capturing" ? <p className="muted small">Capturing payment...</p> : null}
          {status === "success" ? <p className="checkout-success">Purchase complete</p> : null}
          {error ? <p className="form-error">{error}</p> : null}
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
  const keyBalance = Number(wallet?.keys) || 0;
  const canUseKey = gacha?.id === "chiikawa-frame" && keyBalance > 0;
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

  async function draw(useKey = false) {
    if (!gacha?.id || drawing || complete) return;
    setDrawing(true);
    setError("");
    setReward(null);
    setPendingReward(null);
    const res = await onDraw?.(gacha.id, { useKey });
    if (!res || res.error) {
      setError(res?.error || "Draw failed. Try again.");
      setDrawing(false);
      return;
    }
    setPendingReward(res.reward);
    setReelStop(calculateReelStop(res.reward));
    setReelKey((key) => key + 1);
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
                <ShopMedia src={item.imageUrl} className="gacha-reel-media" alt="" />
              </div>
            ))}
          </div>
          <div className="gacha-focus-ring" aria-hidden />
          <div className="gacha-pointer" aria-hidden />
          <div className={`gacha-win-indicator${reward ? " is-visible" : ""}`}>
            {reward ? (
              <>
                <ShopMedia src={reward.imageUrl} className="gacha-win-media" alt="" />
                <span>You got</span>
                <strong>{reward.name}</strong>
              </>
            ) : (
              <span>Reward lands here</span>
            )}
          </div>
        </div>

        <div className="gacha-pool-grid">
          {(gacha?.pool || []).map((item) => (
            <div key={item.id} className={`gacha-pool-item ${item.owned ? "owned" : ""} ${item.type === "profile_frame" ? "rare" : ""}`}>
              <ShopMedia src={item.imageUrl} className="gacha-pool-media" alt="" />
              <span>
                {item.type === "profile_badge" ? "Badge"
                  : item.type === "profile_card_background" ? "Background"
                  : item.type === "gacha_key" ? "Key"
                  : "Frame"}
              </span>
              <strong>{item.name}</strong>
              <small>{item.owned ? "Owned" : item.chanceGroup}</small>
            </div>
          ))}
        </div>

        {reward ? (
          <div className={`gacha-result ${reward.type === "profile_frame" ? "rare" : ""}`}>
            <ShopMedia src={reward.imageUrl} className="gacha-result-media" alt="" />
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
            <KeyAmount value={keyBalance} />
          </div>
          <div className="gacha-draw-actions">
            {gacha?.id === "chiikawa-frame" ? (
              <button type="button" className="btn btn-secondary gacha-draw-btn gacha-key-draw-btn" disabled={drawing || complete || !canUseKey} onClick={() => draw(true)}>
                {drawing ? "Drawing..." : complete ? "Complete" : (
                  <>
                    <span>Draw with key</span>
                    <KeyAmount value={1} suffix="" className="key-amount-inline" />
                  </>
                )}
              </button>
            ) : null}
            <button type="button" className="btn btn-primary gacha-draw-btn" disabled={drawing || complete || !canAfford} onClick={() => draw(false)}>
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
    </div>
  );
}

export default function ShopPage({
  wallet,
  items = [],
  gacha = null,
  gachas = [],
  monthlyCard = null,
  currentUser,
  onBuy,
  onDrawGacha,
  onCreatePayPalOrder,
  onCapturePayPalOrder,
  onClaimMonthlyDaily
}) {
  const [activeTab, setActiveTab] = useState("cosmetics");
  const [selectedGacha, setSelectedGacha] = useState(null);
  const [checkoutProduct, setCheckoutProduct] = useState(null);
  const [claimingDaily, setClaimingDaily] = useState(false);
  const limitedCollections = useMemo(() => {
    const collections = (gachas.length ? gachas : (gacha ? [gacha] : []))
      .filter((collection) => collection.id !== "alien-stage-frame");
    const withExe = collections.some((collection) => collection.id === fallbackExeGacha.id)
      ? collections
      : [fallbackExeGacha, ...collections];
    return withExe.some((collection) => collection.id === fallbackChiikawaGacha.id)
      ? withExe
      : [...withExe, fallbackChiikawaGacha];
  }, [gacha, gachas]);
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
  const monthlyProduct = {
    sku: "monthly_card",
    kind: "monthly_card",
    title: "Purxu Monthly Card Bundle",
    price: "$9.69",
    coins: 300,
    imageUrl: "/assets/purxu-monthly-card-bundle.png"
  };
  const showDailyClaim = monthlyCard?.active && monthlyCard?.canClaimDaily;

  async function claimDaily() {
    setClaimingDaily(true);
    await onClaimMonthlyDaily?.();
    setClaimingDaily(false);
  }

  return (
    <section className="shop-page">
      {showDailyClaim ? (
        <div className="monthly-claim-pop">
          <div>
            <small>Monthly Card</small>
            <strong>Claim your 20 daily coins</strong>
          </div>
          <button type="button" className="btn btn-primary btn-sm" disabled={claimingDaily} onClick={claimDaily}>
            {claimingDaily ? "Claiming..." : "Claim"}
          </button>
        </div>
      ) : null}
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
          <KeyAmount value={wallet?.keys ?? 0} />
        </div>
      </div>

      {activeTab === "cosmetics" ? (
        <>
          <ShopSectionTitle>Limited Cosmetics</ShopSectionTitle>
          <div className="shop-limited-grid">
            {limitedCollections.map((collection) => (
              <button
                key={collection.id}
                type="button"
                className={`shop-gacha-banner ${collection.id === "exe-profile-card" ? "shop-gacha-banner--exe" : ""}`}
                onClick={() => setSelectedGacha(collection)}
              >
                <ShopMedia src={collection.bannerUrl} className="shop-gacha-banner-media" alt="" />
                {collection.id === "exe-profile-card" ? <img className="shop-gacha-exe-frame" src="/assets/exe-frame.png" alt="" /> : null}
                <span className="shop-gacha-banner-shade" aria-hidden />
                <span className="shop-gacha-banner-copy">
                  <small>{collection.badgeText || "Gacha Collection"}</small>
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
              <article key={pack.sku} className="coin-shop-card">
                <img src={pack.imageUrl} alt="" />
                <div>
                  <CoinAmount value={pack.coins} />
                  <strong>{pack.price} usd</strong>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setCheckoutProduct({ ...pack, title: `${pack.coins.toLocaleString()} Coins`, kind: "coins" })}
                >
                  Purchase
                </button>
              </article>
            ))}
          </div>
        </>
      ) : null}

      {activeTab === "bundles" ? (
        <>
          <ShopSectionTitle>Bundles</ShopSectionTitle>
          <div className="bundle-grid">
            <button type="button" className="bundle-card" onClick={() => setCheckoutProduct(monthlyProduct)}>
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
          onDraw={async (collectionId, options) => {
            const res = await onDrawGacha?.(collectionId, options);
            const nextGacha = res?.gachas?.find((collection) => collection.id === collectionId) || res?.gacha;
            if (nextGacha) setSelectedGacha(nextGacha);
            return res;
          }}
        />
      ) : null}
      {checkoutProduct ? (
        <CheckoutModal
          product={checkoutProduct}
          onClose={() => setCheckoutProduct(null)}
          onCreateOrder={onCreatePayPalOrder}
          onCaptureOrder={onCapturePayPalOrder}
        />
      ) : null}
    </section>
  );
}
