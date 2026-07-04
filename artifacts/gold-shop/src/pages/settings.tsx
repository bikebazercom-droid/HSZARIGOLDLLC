import React, { useEffect, useState } from "react";
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
import { Settings, Building2, MapPin, Image, Upload, X, Users, Stamp } from "lucide-react";
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
