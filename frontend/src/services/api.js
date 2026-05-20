const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";
const API = `${API_BASE.replace(/\/$/, "")}/api`;
export const API_ORIGIN = API_BASE.replace(/\/$/, "");

export function mediaUrl(url) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_ORIGIN}${url.startsWith("/") ? "" : "/"}${url}`;
}

export async function request(path, { token, method = "GET", body, onUnauthorizedRetry } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });

    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && typeof onUnauthorizedRetry === "function") {
      const retryResponse = await onUnauthorizedRetry();
      if (retryResponse?.retryWithToken) {
        return request(path, {
          token: retryResponse.retryWithToken,
          method,
          body,
          onUnauthorizedRetry
        });
      }
    }
    if (!res.ok && !data.error) {
      return { error: `Request failed (${res.status})` };
    }
    return data;
  } catch (error) {
    return { error: "Cannot connect to server. Check VITE_API_BASE_URL or that the backend is running." };
  }
}

export async function requestForm(path, { token, method = "POST", formData, onUnauthorizedRetry } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: formData
    });

    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && typeof onUnauthorizedRetry === "function") {
      const retryResponse = await onUnauthorizedRetry();
      if (retryResponse?.retryWithToken) {
        return requestForm(path, {
          token: retryResponse.retryWithToken,
          method,
          formData,
          onUnauthorizedRetry
        });
      }
    }
    if (!res.ok && !data.error) {
      return { error: `Request failed (${res.status})` };
    }
    return data;
  } catch (error) {
    return { error: "Cannot connect to server. Check VITE_API_BASE_URL or that the backend is running." };
  }
}
