import React, { useEffect, useState, useCallback } from "react";
import {
  useGetSettings,
  useUpdateSettings,
  getGetSettingsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Settings, Building2, MapPin, Image, Upload, X, Users, Stamp, Tv, Key, Eye, EyeOff, RefreshCw, Wifi, WifiOff, CheckCircle2, XCircle, Activity } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/context/auth";
import AdminUsersPanel from "@/pages/admin/users";

export default function SettingsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("company");
  const { data: settings, isLoading } = useGetSettings({
    query: { queryKey: getGetSettingsQueryKey() }
  });
  const updateSettings = useUpdateSettings();

  const [companyName, setCompanyName] = useState("");
  const [tagline, setTagline] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [trn, setTrn] = useState("");
  const [locationUrl, setLocationUrl] = useState("");
  const [logoType, setLogoType] = useState("monogram");
  const [logoInitial, setLogoInitial] = useState("H");
  const [logoImageUrl, setLogoImageUrl] = useState<string>("");
  const [stampSignatureUrl, setStampSignatureUrl] = useState<string>("");

  // ── TV / Sync state ─────────────────────────────────────────────────────────
  const [externalSyncUrl,     setExternalSyncUrl]     = useState("https://www.hazarigold.com/");
  const [externalSyncEnabled, setExternalSyncEnabled] = useState(false);
  const [uniRateApiToken,     setUniRateApiToken]     = useState("");
  const [uniRateApiEnabled,   setUniRateApiEnabled]   = useState(true);
  const [showToken,           setShowToken]           = useState(false);
  const [tvSaving,            setTvSaving]            = useState(false);
  const [testResult,          setTestResult]          = useState<{ ok: boolean; source?: string; midUsd?: number; error?: string } | null>(null);
  const [testing,             setTesting]             = useState(false);
  const [livePrices,          setLivePrices]          = useState<any>(null);

  const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

  const fetchLivePrices = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/tv/prices`);
      if (res.ok) setLivePrices(await res.json());
    } catch {}
  }, [BASE]);

  // Poll live prices every 5s on the TV tab
  useEffect(() => {
    if (activeTab !== "tv") return;
    fetchLivePrices();
    const t = setInterval(fetchLivePrices, 5000);
    return () => clearInterval(t);
  }, [activeTab, fetchLivePrices]);

  useEffect(() => {
    if (settings) {
      setCompanyName(settings.companyName ?? "");
      setTagline(settings.tagline ?? "");
      setAddress(settings.address ?? "");
      setPhone(settings.phone ?? "");
      setEmail(settings.email ?? "");
      setTrn(settings.trn ?? "");
      setLocationUrl(settings.locationUrl ?? "");
      setLogoType(settings.logoType ?? "monogram");
      setLogoInitial(settings.logoInitial ?? "H");
      setLogoImageUrl(settings.logoImageUrl ?? "");
      setStampSignatureUrl(settings.stampSignatureUrl ?? "");
      setExternalSyncUrl((settings as any).externalSyncUrl ?? "https://www.hazarigold.com/");
      setExternalSyncEnabled((settings as any).externalSyncEnabled ?? false);
      setUniRateApiEnabled((settings as any).uniRateApiEnabled ?? true);
    }
  }, [settings]);

  const handleSave = () => {
    updateSettings.mutate({
      data: {
        companyName,
        tagline,
        address,
        phone,
        email,
        trn,
        locationUrl,
        logoType,
        logoInitial,
        logoImageUrl,
        stampSignatureUrl,
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
        toast({ title: "Settings saved successfully" });
      },
      onError: (err: any) => {
        toast({ title: "Failed to save settings", description: err.message, variant: "destructive" });
      }
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-4xl mx-auto">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="h-64 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-20">
      <div className="flex items-center gap-3">
        <Settings className="w-8 h-8 text-primary" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary">Settings</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage your company details and invoice preferences</p>
        </div>
      </div>

      {user?.role === "admin" && (
        <Tabs defaultValue="company" onValueChange={setActiveTab}>
          <TabsList className="mb-2">
            <TabsTrigger value="company" className="flex items-center gap-2">
              <Building2 className="w-4 h-4" /> Company Settings
            </TabsTrigger>
            <TabsTrigger value="tv" className="flex items-center gap-2">
              <Tv className="w-4 h-4" /> Live TV & Sync
            </TabsTrigger>
            <TabsTrigger value="users" className="flex items-center gap-2">
              <Users className="w-4 h-4" /> User Management
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users">
            <AdminUsersPanel />
          </TabsContent>

          {/* ── TV & Sync Tab ──────────────────────────────────────────────── */}
          <TabsContent value="tv">
            <div className="space-y-6">

              {/* External Source Sync */}
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Wifi className="w-5 h-5 text-primary" />
                    <CardTitle>External Price Source</CardTitle>
                  </div>
                  <CardDescription>
                    Configure a URL to scrape live gold prices from (e.g. hazarigold.com).
                    When enabled, the server polls it every 5 seconds and broadcasts updates.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Switch
                      id="ext-sync-toggle"
                      checked={externalSyncEnabled}
                      onCheckedChange={setExternalSyncEnabled}
                    />
                    <Label htmlFor="ext-sync-toggle" className="text-sm font-medium cursor-pointer">
                      {externalSyncEnabled ? "External sync enabled" : "External sync disabled"}
                    </Label>
                  </div>
                  <div className="space-y-2">
                    <Label>Source URL</Label>
                    <Input
                      value={externalSyncUrl}
                      onChange={e => setExternalSyncUrl(e.target.value)}
                      placeholder="https://www.hazarigold.com/"
                      disabled={!externalSyncEnabled}
                    />
                    <p className="text-xs text-muted-foreground">
                      The server will attempt to parse gold prices from this page's HTML.
                      If the site is client-rendered (prices load via JavaScript), the server
                      automatically falls back to UniRateAPI.
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* UniRateAPI Config */}
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Key className="w-5 h-5 text-primary" />
                    <CardTitle>UniRateAPI (Fallback / Primary)</CardTitle>
                  </div>
                  <CardDescription>
                    Used when the external scrape fails or is disabled. Provides live
                    XAU/USD gold spot pricing via the UniRateAPI service.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Switch
                      id="uni-toggle"
                      checked={uniRateApiEnabled}
                      onCheckedChange={setUniRateApiEnabled}
                    />
                    <Label htmlFor="uni-toggle" className="text-sm font-medium cursor-pointer">
                      {uniRateApiEnabled ? "UniRateAPI enabled" : "UniRateAPI disabled"}
                    </Label>
                  </div>
                  <div className="space-y-2">
                    <Label>API Key</Label>
                    <div className="relative">
                      <Input
                        type={showToken ? "text" : "password"}
                        value={uniRateApiToken}
                        onChange={e => setUniRateApiToken(e.target.value)}
                        placeholder={(settings as any)?.uniRateApiTokenSet ? "••••••••••••••••••••••••••••••••" : "Enter your UniRateAPI key…"}
                        className="pr-10"
                      />
                      <button
                        type="button"
                        className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowToken(v => !v)}
                      >
                        {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {(settings as any)?.uniRateApiTokenSet
                        ? "✓ A key is stored. Leave blank to keep the existing key, or enter a new one to replace it."
                        : "No key stored. The UNIRATE_API_KEY environment variable will be used as a fallback."}
                    </p>
                  </div>

                  {/* Test Connection */}
                  <div className="flex items-center gap-3 pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={testing}
                      onClick={async () => {
                        setTesting(true);
                        setTestResult(null);
                        try {
                          const res = await fetch(`${BASE}/api/tv/test`);
                          const data = await res.json();
                          setTestResult(data);
                        } catch(e: any) {
                          setTestResult({ ok: false, error: e.message });
                        } finally {
                          setTesting(false);
                        }
                      }}
                    >
                      {testing
                        ? <><RefreshCw className="w-4 h-4 mr-1.5 animate-spin" /> Testing…</>
                        : <><Wifi className="w-4 h-4 mr-1.5" /> Test Connection</>}
                    </Button>
                    {testResult && (
                      <div className={`flex items-center gap-1.5 text-sm font-medium ${testResult.ok ? "text-green-600" : "text-red-500"}`}>
                        {testResult.ok
                          ? <><CheckCircle2 className="w-4 h-4" /> Connected via {testResult.source} — ${testResult.midUsd?.toFixed(2)}/oz</>
                          : <><XCircle className="w-4 h-4" /> {testResult.error ?? "Connection failed"}</>}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Save button */}
              <div className="flex justify-end">
                <Button
                  disabled={tvSaving}
                  onClick={async () => {
                    setTvSaving(true);
                    try {
                      updateSettings.mutate({
                        data: {
                          externalSyncUrl,
                          externalSyncEnabled,
                          uniRateApiEnabled,
                          ...(uniRateApiToken ? { uniRateApiToken } : {}),
                        }
                      }, {
                        onSuccess: () => {
                          queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
                          toast({ title: "TV & Sync settings saved" });
                          setUniRateApiToken(""); // clear field after save
                        },
                        onError: (err: any) => {
                          toast({ title: "Failed to save", description: err.message, variant: "destructive" });
                        },
                        onSettled: () => setTvSaving(false),
                      });
                    } catch {
                      setTvSaving(false);
                    }
                  }}
                >
                  {tvSaving ? "Saving…" : "Save TV & Sync Settings"}
                </Button>
              </div>

              {/* Live Price Feed Dashboard */}
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Activity className="w-5 h-5 text-primary" />
                    <CardTitle>Live Price Feed</CardTitle>
                  </div>
                  <CardDescription>
                    Real-time prices from the active source. Updates every 5 seconds automatically.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {!livePrices && (
                    <div className="text-center text-muted-foreground py-6">Loading live prices…</div>
                  )}
                  {livePrices?.error && !livePrices?.baseAedPerGram && (
                    <div className="flex items-center gap-2 text-sm text-red-500 mb-4">
                      <WifiOff className="w-4 h-4" />
                      {livePrices.error}
                    </div>
                  )}
                  {livePrices && (
                    <div className="space-y-4">
                      {/* Gold Spot row */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {[
                          { label: "Gold Spot BID", value: livePrices?.bidUsd != null ? `$${livePrices.bidUsd.toFixed(2)}/oz` : "—" },
                          { label: "Gold Spot ASK", value: livePrices?.askUsd != null ? `$${livePrices.askUsd.toFixed(2)}/oz` : "—" },
                          { label: "Daily High",    value: livePrices?.dailyHigh != null ? `$${livePrices.dailyHigh.toFixed(2)}` : "—" },
                          { label: "Daily Low",     value: livePrices?.dailyLow  != null ? `$${livePrices.dailyLow.toFixed(2)}`  : "—" },
                        ].map(({ label, value }) => (
                          <div key={label} className="rounded-lg border bg-muted/30 p-3 space-y-1">
                            <p className="text-xs text-muted-foreground">{label}</p>
                            <p className="font-bold text-base">{value}</p>
                          </div>
                        ))}
                      </div>

                      {/* AED/gram */}
                      <div className="rounded-lg border bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 p-3 flex items-center justify-between">
                        <div>
                          <p className="text-xs text-muted-foreground">Base Rate (AED/gram)</p>
                          <p className="font-bold text-xl text-amber-700 dark:text-amber-300">
                            AED {livePrices?.baseAedPerGram != null ? livePrices.baseAedPerGram.toFixed(4) : "—"}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">Source</p>
                          <p className="font-medium text-sm">{livePrices?.source ?? "—"}</p>
                          {livePrices?.updatedAt && (
                            <p className="text-xs text-muted-foreground">
                              {new Date(livePrices.updatedAt).toLocaleTimeString()}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Item prices table */}
                      {livePrices?.items?.length > 0 && (
                        <div className="rounded-lg border overflow-hidden">
                          <table className="w-full text-sm">
                            <thead className="bg-muted/50">
                              <tr>
                                <th className="text-left px-4 py-2.5 font-semibold">Item</th>
                                <th className="text-left px-4 py-2.5 font-semibold">Unit</th>
                                <th className="text-right px-4 py-2.5 font-semibold">Live Price (AED)</th>
                                <th className="text-center px-4 py-2.5 font-semibold text-xs text-muted-foreground">Source</th>
                              </tr>
                            </thead>
                            <tbody>
                              {livePrices.items.map((item: any, i: number) => (
                                <tr key={item.id} className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                                  <td className="px-4 py-2.5 font-medium">{item.name}</td>
                                  <td className="px-4 py-2.5 text-muted-foreground">{item.weightLabel}</td>
                                  <td className="px-4 py-2.5 text-right font-mono font-bold">
                                    {item.price != null
                                      ? item.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                      : "—"}
                                  </td>
                                  <td className="px-4 py-2.5 text-center">
                                    <span className={`text-xs px-1.5 py-0.5 rounded ${item.source === "scraped" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"}`}>
                                      {item.source === "scraped" ? "scraped" : "computed"}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* TV Board link */}
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Tv className="w-5 h-5 text-primary" />
                    <CardTitle>TV Display Board</CardTitle>
                  </div>
                  <CardDescription>
                    Open the full-screen TV board for displaying live prices on a showroom screen.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    variant="outline"
                    onClick={() => window.open(`${BASE}/tv`, "_blank")}
                  >
                    <Tv className="w-4 h-4 mr-2" />
                    Open TV Board
                  </Button>
                </CardContent>
              </Card>

            </div>
          </TabsContent>
        </Tabs>
      )}

      {(activeTab === "company") && (
      <>{/* Company Info */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-primary" />
            <CardTitle>Company Information</CardTitle>
          </div>
          <CardDescription>These details appear on every printed invoice</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Company Name</Label>
              <Input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="HAZARI GOLD L.L.C" />
            </div>
            <div className="space-y-2">
              <Label>Tagline / Sub-heading</Label>
              <Input value={tagline} onChange={e => setTagline(e.target.value)} placeholder="e.g. Fine Gold & Jewellery" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Address</Label>
            <Textarea
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="Full address..."
              className="h-20 resize-none"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+971 50 536 4193" />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="hazarigoldllc@gmail.com" type="email" />
            </div>
          </div>
          <div className="space-y-2 max-w-xs">
            <Label>TRN (Tax Registration Number)</Label>
            <Input value={trn} onChange={e => setTrn(e.target.value)} placeholder="105301944200003" />
          </div>
        </CardContent>
      </Card>

      {/* Logo */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Image className="w-5 h-5 text-primary" />
            <CardTitle>Logo Style</CardTitle>
          </div>
          <CardDescription>Choose how your company logo appears on invoices</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Logo type selector */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { value: "image", label: "Upload Image", icon: <Upload className="w-5 h-5" /> },
              { value: "monogram", label: "Monogram Letter", icon: <span className="text-lg font-bold font-serif">H</span> },
              { value: "none", label: "No Logo", icon: <X className="w-5 h-5" /> },
            ].map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setLogoType(opt.value)}
                className={`flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all ${
                  logoType === opt.value
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border hover:border-primary/40 text-muted-foreground"
                }`}
              >
                {opt.icon}
                <span className="text-xs font-medium">{opt.label}</span>
              </button>
            ))}
          </div>

          {/* Upload image */}
          {logoType === "image" && (
            <div className="space-y-3">
              <Label>Logo Image</Label>
              {logoImageUrl ? (
                <div className="flex items-center gap-4">
                  <div className="w-20 h-20 rounded-lg border overflow-hidden bg-white flex items-center justify-center p-1">
                    <img src={logoImageUrl} alt="Logo" className="max-w-full max-h-full object-contain" />
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm text-green-700 font-medium">✓ Logo uploaded</p>
                    <label className="cursor-pointer">
                      <span className="text-xs text-primary underline">Replace image</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={e => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const reader = new FileReader();
                          reader.onload = ev => {
                            const img = new window.Image();
                            img.onload = () => {
                              const canvas = document.createElement("canvas");
                              const MAX = 300;
                              const scale = Math.min(1, MAX / Math.max(img.width, img.height));
                              canvas.width = img.width * scale;
                              canvas.height = img.height * scale;
                              canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
                              setLogoImageUrl(canvas.toDataURL("image/png"));
                            };
                            img.src = ev.target?.result as string;
                          };
                          reader.readAsDataURL(file);
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => setLogoImageUrl("")}
                      className="block text-xs text-destructive underline"
                    >
                      Remove logo
                    </button>
                  </div>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center gap-3 p-8 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-all">
                  <Upload className="w-8 h-8 text-muted-foreground" />
                  <div className="text-center">
                    <div className="text-sm font-medium">Click to upload your logo</div>
                    <div className="text-xs text-muted-foreground mt-0.5">PNG, JPG, SVG · Any size</div>
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = ev => {
                        const img = new window.Image();
                        img.onload = () => {
                          const canvas = document.createElement("canvas");
                          const MAX = 300;
                          const scale = Math.min(1, MAX / Math.max(img.width, img.height));
                          canvas.width = img.width * scale;
                          canvas.height = img.height * scale;
                          canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
                          setLogoImageUrl(canvas.toDataURL("image/png"));
                        };
                        img.src = ev.target?.result as string;
                      };
                      reader.readAsDataURL(file);
                    }}
                  />
                </label>
              )}
            </div>
          )}

          {/* Monogram letter */}
          {logoType === "monogram" && (
            <div className="space-y-2 max-w-xs">
              <Label>Monogram Letter</Label>
              <Input
                value={logoInitial}
                onChange={e => setLogoInitial(e.target.value.slice(0, 2).toUpperCase())}
                placeholder="H"
                maxLength={2}
                className="w-24 text-center text-2xl font-bold"
              />
            </div>
          )}

          {/* Preview */}
          <div className="flex items-center gap-4 p-4 bg-muted/20 rounded-lg border">
            <div className="text-xs text-muted-foreground uppercase tracking-wide font-medium w-14">Preview</div>
            <div className="flex items-center gap-3">
              {logoType === "image" && logoImageUrl ? (
                <div style={{ width: "60px", height: "60px", background: "#fff", borderRadius: "6px", border: "1px solid #e5e7eb", display: "flex", alignItems: "center", justifyContent: "center", padding: "4px" }}>
                  <img src={logoImageUrl} alt="Logo" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                </div>
              ) : logoType === "monogram" ? (
                <div style={{ width: "60px", height: "60px", background: "#1e3a5f", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ color: "#c8a43a", fontSize: "26px", fontWeight: "bold", fontFamily: "Georgia, serif" }}>
                    {logoInitial || "H"}
                  </span>
                </div>
              ) : (
                <div className="w-[60px] h-[60px] bg-muted rounded flex items-center justify-center text-muted-foreground text-xs">
                  none
                </div>
              )}
              <div>
                <div style={{ fontSize: "16px", fontWeight: "bold", color: "#c8a43a", fontFamily: "Georgia, serif" }}>
                  {companyName.split(" ").slice(0, 2).join(" ") || "Hazari Gold"}
                </div>
                <div style={{ fontSize: "12px", fontWeight: "bold", color: "#1e3a5f" }}>
                  {companyName || "HAZARI GOLD L.L.C"}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Authorized Stamp & Signature */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Stamp className="w-5 h-5 text-primary" />
            <CardTitle>Authorized Stamp & Signature</CardTitle>
          </div>
          <CardDescription>
            Upload your company stamp/signature image — it appears automatically under "Authorised Signature" on every invoice
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {stampSignatureUrl ? (
            <div className="flex items-center gap-4">
              <div className="w-28 h-20 rounded-lg border overflow-hidden bg-white flex items-center justify-center p-1">
                <img src={stampSignatureUrl} alt="Authorized stamp and signature" className="max-w-full max-h-full object-contain" />
              </div>
              <div className="space-y-2">
                <p className="text-sm text-green-700 font-medium">✓ Stamp & signature uploaded</p>
                <label className="cursor-pointer">
                  <span className="text-xs text-primary underline">Replace image</span>
                  <input
                    type="file"
                    accept=".png,.jpg,.jpeg,image/png,image/jpeg"
                    className="hidden"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = ev => setStampSignatureUrl(ev.target?.result as string);
                      reader.readAsDataURL(file);
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setStampSignatureUrl("")}
                  className="block text-xs text-destructive underline"
                >
                  Remove image
                </button>
              </div>
            </div>
          ) : (
            <label className="flex flex-col items-center justify-center gap-3 p-8 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-all">
              <Stamp className="w-8 h-8 text-muted-foreground" />
              <div className="text-center">
                <div className="text-sm font-medium">Click to upload your stamp & signature</div>
                <div className="text-xs text-muted-foreground mt-0.5">PNG, JPG · Merged stamp+signature image recommended</div>
              </div>
              <input
                type="file"
                accept=".png,.jpg,.jpeg,image/png,image/jpeg"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = ev => setStampSignatureUrl(ev.target?.result as string);
                  reader.readAsDataURL(file);
                }}
              />
            </label>
          )}
        </CardContent>
      </Card>

      {/* Location QR Code */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-primary" />
            <CardTitle>Location QR Code</CardTitle>
          </div>
          <CardDescription>
            Paste your Google Maps link — a scannable QR code will appear on every printed invoice
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Google Maps / Location URL</Label>
            <Input
              value={locationUrl}
              onChange={e => setLocationUrl(e.target.value)}
              placeholder="https://maps.google.com/?q=Hazari+Gold+Dubai"
              type="url"
            />
            <p className="text-xs text-muted-foreground">
              Open Google Maps, search your shop, tap Share → Copy link, then paste it here.
            </p>
          </div>

          {locationUrl && (
            <div className="flex items-start gap-6 p-4 bg-muted/30 rounded-lg border">
              <div className="bg-white p-2 rounded border">
                <QRCodeSVG value={locationUrl} size={100} />
              </div>
              <div className="text-sm space-y-1">
                <div className="font-medium text-green-700">✓ QR Code ready</div>
                <div className="text-muted-foreground">This code will appear on printed invoices.</div>
                <div className="text-muted-foreground">Customers can scan it to find your shop location.</div>
                <a
                  href={locationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline text-xs break-all"
                >
                  {locationUrl.length > 60 ? locationUrl.slice(0, 60) + "..." : locationUrl}
                </a>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          size="lg"
          onClick={handleSave}
          disabled={updateSettings.isPending}
          className="min-w-32"
        >
          {updateSettings.isPending ? "Saving..." : "Save Settings"}
        </Button>
      </div>
      </>
      )}
    </div>
  );
}
