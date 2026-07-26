import React, { useEffect, useState } from "react";
import {
  useGetSettings,
  useUpdateSettings,
  getGetSettingsQueryKey,
  useGetPrices,
  useUpdatePrices,
  getGetPricesQueryKey,
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
import { Settings, Building2, MapPin, Image, Upload, X, Users, Stamp, Tv, Key, Power, Plus, Minus, Sliders } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/context/auth";
import AdminUsersPanel from "@/pages/admin/users";

// Sentinel shown in the password input when a token is already stored in DB.
// Any non-empty string works since the field renders bullet characters — this
// constant is never sent to the API. It is ONLY used for UI state detection.
const CONFIGURED_SENTINEL = "__token_configured__";

export default function SettingsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("company");
  const { data: settings, isLoading } = useGetSettings({
    query: { queryKey: getGetSettingsQueryKey() }
  });
  const updateSettings = useUpdateSettings();

  const { data: prices } = useGetPrices({ query: { queryKey: getGetPricesQueryKey() } });
  const updatePrices = useUpdatePrices();

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
  const [showroomLogoUrl, setShowroomLogoUrl] = useState<string>("");
  // uniRateApiToken holds the new token the user types, OR the sentinel when a
  // token is already configured (so the password field shows bullet characters
  // rather than appearing blank on page load / tab navigation).
  const [uniRateApiToken, setUniRateApiToken] = useState<string>("");
  // uniRateApiEnabled mirrors the DB boolean — toggled immediately without a
  // separate "Save" click so it feels instantaneous.
  const [uniRateApiEnabled, setUniRateApiEnabled] = useState<boolean>(true);

  // ── Live rate manual offsets ───────────────────────────────────────────────
  const [gold9999Offset, setGold9999Offset] = useState<number>(0);
  const [jewellery22kOffset, setJewellery22kOffset] = useState<number>(0);
  const [savingOffsets, setSavingOffsets] = useState(false);

  useEffect(() => {
    if (prices) {
      setGold9999Offset((prices as any).gold9999Offset ?? 0);
      setJewellery22kOffset((prices as any).jewellery22kOffset ?? 0);
    }
  }, [prices]);

  const handleSaveOffsets = () => {
    setSavingOffsets(true);
    updatePrices.mutate(
      { data: { gold9999Offset, jewellery22kOffset } as any },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetPricesQueryKey() });
          toast({
            title: "Live Rate Offsets Saved",
            description: "The TV board and price cards will reflect the new adjustments on the next 1-second tick.",
          });
        },
        onError: (err: any) => {
          toast({ title: "Failed to save offsets", description: err.message, variant: "destructive" });
        },
        onSettled: () => setSavingOffsets(false),
      },
    );
  };

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
      setShowroomLogoUrl(settings.showroomLogoUrl ?? "");
      // Pre-populate with sentinel so the password field shows bullet chars
      // instead of an empty box — the raw token is never returned by the API.
      setUniRateApiToken((settings as any).uniRateApiTokenSet ? CONFIGURED_SENTINEL : "");
      setUniRateApiEnabled((settings as any).uniRateApiEnabled ?? true);
    }
  }, [settings]);

  const handleSaveUniRate = () => {
    if (uniRateApiToken === CONFIGURED_SENTINEL) {
      toast({
        title: "No changes made",
        description: "The existing token is already saved. Paste a new token to replace it, or clear the field to remove it.",
      });
      return;
    }
    updateSettings.mutate({ data: { uniRateApiToken } as any }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
        toast({ title: "UniRateAPI token saved", description: "Live pricing will use UniRateAPI on the next poll." });
      },
      onError: (err: any) => {
        toast({ title: "Failed to save token", description: err.message, variant: "destructive" });
      }
    });
  };

  const handleToggleUniRate = (checked: boolean) => {
    setUniRateApiEnabled(checked);
    updateSettings.mutate({ data: { uniRateApiEnabled: checked } as any }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
        toast({
          title: checked ? "UniRateAPI enabled" : "UniRateAPI disabled",
          description: checked
            ? "UniRateAPI is now the active fallback price source."
            : "Switched to other fallback feeds.",
        });
      },
      onError: (err: any) => {
        setUniRateApiEnabled(!checked);
        toast({ title: "Failed to update toggle", description: err.message, variant: "destructive" });
      }
    });
  };

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
        showroomLogoUrl,
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
            <TabsTrigger value="users" className="flex items-center gap-2">
              <Users className="w-4 h-4" /> User Management
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users">
            <AdminUsersPanel />
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

      {/* Showroom TV Logo */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Tv className="w-5 h-5 text-primary" />
            <CardTitle>Showroom TV Logo</CardTitle>
          </div>
          <CardDescription>
            Upload a custom logo to display at the top of the Showroom Live Price Board (/tv). Leave empty to show the default text header.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {showroomLogoUrl ? (
            <div className="flex items-center gap-4">
              <div className="w-28 h-20 rounded-lg border overflow-hidden bg-black flex items-center justify-center p-2">
                <img src={showroomLogoUrl} alt="Showroom TV logo" className="max-w-full max-h-full object-contain" />
              </div>
              <div className="space-y-2">
                <p className="text-sm text-green-700 font-medium">✓ Showroom logo uploaded</p>
                <label className="cursor-pointer">
                  <span className="text-xs text-primary underline">Replace image</span>
                  <input
                    type="file"
                    accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml"
                    className="hidden"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = ev => setShowroomLogoUrl(ev.target?.result as string);
                      reader.readAsDataURL(file);
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setShowroomLogoUrl("")}
                  className="block text-xs text-destructive underline"
                >
                  Remove logo
                </button>
              </div>
            </div>
          ) : (
            <label className="flex flex-col items-center justify-center gap-3 p-8 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-all">
              <Tv className="w-8 h-8 text-muted-foreground" />
              <div className="text-center">
                <div className="text-sm font-medium">Click to upload your showroom TV logo</div>
                <div className="text-xs text-muted-foreground mt-0.5">PNG, JPG, SVG · Transparent background recommended</div>
              </div>
              <input
                type="file"
                accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = ev => setShowroomLogoUrl(ev.target?.result as string);
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

      {/* UniRateAPI Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Key className="w-5 h-5 text-primary" />
              <CardTitle>UniRateAPI Settings</CardTitle>
            </div>
            {/* Enable / Disable toggle — only meaningful when a token is set */}
            {(settings as any)?.uniRateApiTokenSet && (
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-muted-foreground">
                  {uniRateApiEnabled ? "Enabled" : "Disabled"}
                </span>
                <Switch
                  checked={uniRateApiEnabled}
                  onCheckedChange={handleToggleUniRate}
                  disabled={updateSettings.isPending}
                  aria-label="Enable UniRateAPI"
                  className={uniRateApiEnabled ? "data-[state=checked]:bg-green-500" : ""}
                />
              </div>
            )}
          </div>
          <CardDescription>
            Configure your UniRateAPI token to fetch the official XAU/USD spot price (LBMA-blended, updates every 15 minutes).
            Use the toggle to enable or disable it without losing the token.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* Status badge */}
          <div className="flex items-center gap-2 rounded-lg border px-3 py-2 bg-muted/30">
            <Power className={`w-4 h-4 flex-shrink-0 ${(settings as any)?.uniRateApiTokenSet && uniRateApiEnabled ? "text-green-500" : "text-muted-foreground"}`} />
            <span className="text-sm font-medium">Status:</span>
            {(settings as any)?.uniRateApiTokenSet ? (
              uniRateApiEnabled ? (
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-green-600">
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse inline-block" />
                  Token configured — UniRateAPI active
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-600">
                  <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
                  Token configured — UniRateAPI paused (toggle OFF)
                </span>
              )
            ) : (
              <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <span className="w-2 h-2 rounded-full bg-muted-foreground/50 inline-block" />
                No token set — using fallback feed
              </span>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="uniRateApiToken">API Token</Label>
            <Input
              id="uniRateApiToken"
              type="password"
              value={uniRateApiToken}
              onFocus={() => {
                if (uniRateApiToken === CONFIGURED_SENTINEL) setUniRateApiToken("");
              }}
              onBlur={() => {
                if (uniRateApiToken === "" && (settings as any)?.uniRateApiTokenSet) {
                  setUniRateApiToken(CONFIGURED_SENTINEL);
                }
              }}
              onChange={e => setUniRateApiToken(e.target.value)}
              placeholder={
                (settings as any)?.uniRateApiTokenSet
                  ? "Paste new token to replace, or clear to remove…"
                  : "Paste your UniRateAPI token here…"
              }
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Get your token from{" "}
              <a href="https://unirateapi.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                unirateapi.com
              </a>
              . To remove the token, clear the field and click Save API Settings.
            </p>
          </div>

          <div className="flex items-center justify-between pt-1">
            <Button
              onClick={handleSaveUniRate}
              disabled={updateSettings.isPending}
              variant="outline"
              className="gap-2"
            >
              <Key className="w-4 h-4" />
              {updateSettings.isPending ? "Saving…" : "Save API Settings"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Live Rate Manual Offset ──────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-primary" />
            <CardTitle>Live Rate Manual Offset</CardTitle>
          </div>
          <CardDescription>
            Add or subtract a flat AED amount to the computed live price for each item type.
            Applied every second — the TV board and price cards update instantly.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* GOLD 9999 */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold">GOLD 9999 Live Adjust (AED/g)</Label>
            <p className="text-xs text-muted-foreground">
              Final Price = Live Dubai Rate + this offset. E.g. +2 adds AED 2.00 per gram.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setGold9999Offset(v => Math.round((v - 0.5) * 100) / 100)}
                className="w-10 h-10 rounded-lg border flex items-center justify-center hover:bg-muted transition-colors flex-shrink-0"
              >
                <Minus className="w-4 h-4" />
              </button>
              <div className="relative flex-1 max-w-[180px]">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium select-none">AED</span>
                <Input
                  type="number"
                  step="0.5"
                  value={gold9999Offset}
                  onChange={e => setGold9999Offset(parseFloat(e.target.value) || 0)}
                  className="pl-14 text-base font-bold h-10 text-center"
                  style={{ fontFamily: "monospace" }}
                />
              </div>
              <button
                type="button"
                onClick={() => setGold9999Offset(v => Math.round((v + 0.5) * 100) / 100)}
                className="w-10 h-10 rounded-lg border flex items-center justify-center hover:bg-muted transition-colors flex-shrink-0"
              >
                <Plus className="w-4 h-4" />
              </button>
              <span className={`text-xs font-semibold px-2 py-1 rounded-full ${gold9999Offset > 0 ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : gold9999Offset < 0 ? "bg-red-50 text-red-700 border border-red-200" : "bg-muted text-muted-foreground"}`}>
                {gold9999Offset > 0 ? `+${gold9999Offset.toFixed(2)}` : gold9999Offset.toFixed(2)} AED
              </span>
            </div>
          </div>

          {/* JEWELLERY 22K */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold">JEWELLERY 22K Live Adjust (AED/g)</Label>
            <p className="text-xs text-muted-foreground">
              Final Price = (Spot × 22/24 × labor%) + this offset. E.g. −1.5 subtracts AED 1.50 per gram.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setJewellery22kOffset(v => Math.round((v - 0.5) * 100) / 100)}
                className="w-10 h-10 rounded-lg border flex items-center justify-center hover:bg-muted transition-colors flex-shrink-0"
              >
                <Minus className="w-4 h-4" />
              </button>
              <div className="relative flex-1 max-w-[180px]">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium select-none">AED</span>
                <Input
                  type="number"
                  step="0.5"
                  value={jewellery22kOffset}
                  onChange={e => setJewellery22kOffset(parseFloat(e.target.value) || 0)}
                  className="pl-14 text-base font-bold h-10 text-center"
                  style={{ fontFamily: "monospace" }}
                />
              </div>
              <button
                type="button"
                onClick={() => setJewellery22kOffset(v => Math.round((v + 0.5) * 100) / 100)}
                className="w-10 h-10 rounded-lg border flex items-center justify-center hover:bg-muted transition-colors flex-shrink-0"
              >
                <Plus className="w-4 h-4" />
              </button>
              <span className={`text-xs font-semibold px-2 py-1 rounded-full ${jewellery22kOffset > 0 ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : jewellery22kOffset < 0 ? "bg-red-50 text-red-700 border border-red-200" : "bg-muted text-muted-foreground"}`}>
                {jewellery22kOffset > 0 ? `+${jewellery22kOffset.toFixed(2)}` : jewellery22kOffset.toFixed(2)} AED
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t">
            <p className="text-xs text-muted-foreground">
              Offset = 0 means no adjustment — the raw computed live price is used as-is.
            </p>
            <Button
              onClick={handleSaveOffsets}
              disabled={savingOffsets}
              className="gap-2 min-w-36"
            >
              <Sliders className="w-4 h-4" />
              {savingOffsets ? "Saving…" : "Save Offsets"}
            </Button>
          </div>
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
