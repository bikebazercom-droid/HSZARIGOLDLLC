import React, { useState, useRef } from "react";
import { useAuth } from "@/context/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Shield, User } from "lucide-react";

type Screen = "home" | "admin" | "staff";

export default function LoginPage() {
  const { login } = useAuth();
  const { toast } = useToast();
  const [screen, setScreen] = useState<Screen>("home");
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [pin, setPin] = useState(["", "", "", ""]);
  const [isLoading, setIsLoading] = useState(false);
  const pinRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];

  const role = screen === "admin" ? "admin" : "staff";

  const handlePinChange = (idx: number, val: string) => {
    const digit = val.replace(/\D/g, "").slice(-1);
    const next = [...pin];
    next[idx] = digit;
    setPin(next);
    if (digit && idx < 3) {
      pinRefs[idx + 1].current?.focus();
    }
  };

  const handlePinKeyDown = (idx: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !pin[idx] && idx > 0) {
      pinRefs[idx - 1].current?.focus();
    }
  };

  const handlePinPaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 4);
    if (text.length === 4) {
      setPin(text.split(""));
      pinRefs[3].current?.focus();
    }
    e.preventDefault();
  };

  const reset = () => {
    setName("");
    setMobile("");
    setPin(["", "", "", ""]);
    setScreen("home");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const fullPin = pin.join("");
    if (!mobile.trim() || fullPin.length < 4) return;
    setIsLoading(true);
    try {
      await login(mobile.trim(), fullPin, role);
    } catch (err: any) {
      toast({ title: "Login failed", description: err.message, variant: "destructive" });
      setPin(["", "", "", ""]);
      pinRefs[0].current?.focus();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: "linear-gradient(145deg, #0f2040 0%, #1e3a5f 60%, #162d4a 100%)" }}
    >
      <div className="w-full max-w-sm">
        {/* Logo + title */}
        <div className="text-center mb-8">
          <div
            className="w-20 h-20 rounded-full mx-auto mb-4 flex items-center justify-center text-3xl font-bold shadow-lg"
            style={{ backgroundColor: "#c8a43a", color: "#1e3a5f" }}
          >
            H
          </div>
          <h1 className="text-2xl font-bold text-white tracking-wide">Hazari Gold L.L.C</h1>
          <p className="text-blue-300 text-sm mt-1">Management Portal</p>
        </div>

        {/* HOME screen — pick role */}
        {screen === "home" && (
          <div className="space-y-4">
            <p className="text-center text-blue-200 text-sm mb-6">Select your login type</p>
            <button
              onClick={() => setScreen("admin")}
              className="w-full flex items-center gap-4 p-5 rounded-2xl border-2 transition-all group text-left"
              style={{
                backgroundColor: "rgba(200,164,58,0.1)",
                borderColor: "#c8a43a",
              }}
            >
              <div className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "#c8a43a" }}>
                <Shield className="w-6 h-6" style={{ color: "#1e3a5f" }} />
              </div>
              <div>
                <div className="font-bold text-white text-lg">Admin Login</div>
                <div className="text-blue-300 text-sm">Full system access</div>
              </div>
            </button>

            <button
              onClick={() => setScreen("staff")}
              className="w-full flex items-center gap-4 p-5 rounded-2xl border-2 transition-all text-left"
              style={{
                backgroundColor: "rgba(255,255,255,0.05)",
                borderColor: "rgba(255,255,255,0.2)",
              }}
            >
              <div className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "rgba(255,255,255,0.15)" }}>
                <User className="w-6 h-6 text-white" />
              </div>
              <div>
                <div className="font-bold text-white text-lg">Staff Login</div>
                <div className="text-blue-300 text-sm">Invoice creation only</div>
              </div>
            </button>
          </div>
        )}

        {/* LOGIN form */}
        {(screen === "admin" || screen === "staff") && (
          <div
            className="rounded-2xl p-6 shadow-2xl"
            style={{ backgroundColor: "rgba(255,255,255,0.97)" }}
          >
            <div className="flex items-center gap-3 mb-6">
              <button onClick={reset} className="text-muted-foreground hover:text-foreground transition-colors">
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-2">
                {screen === "admin"
                  ? <Shield className="w-5 h-5" style={{ color: "#c8a43a" }} />
                  : <User className="w-5 h-5 text-muted-foreground" />}
                <h2 className="text-lg font-bold text-primary">
                  {screen === "admin" ? "Admin Login" : "Staff Login"}
                </h2>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Full Name</Label>
                <Input
                  placeholder="Your full name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  autoComplete="name"
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Mobile Number</Label>
                <Input
                  placeholder="+971 50 536 4193"
                  value={mobile}
                  onChange={e => setMobile(e.target.value)}
                  type="tel"
                  autoComplete="tel"
                  inputMode="numeric"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">4-Digit PIN</Label>
                <div className="flex gap-3 justify-center">
                  {pin.map((digit, idx) => (
                    <input
                      key={idx}
                      ref={pinRefs[idx]}
                      type="password"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={e => handlePinChange(idx, e.target.value)}
                      onKeyDown={e => handlePinKeyDown(idx, e)}
                      onPaste={handlePinPaste}
                      className="w-14 h-14 text-center text-2xl font-bold border-2 rounded-xl outline-none transition-all focus:border-primary"
                      style={{ borderColor: digit ? "#c8a43a" : undefined }}
                    />
                  ))}
                </div>
              </div>

              <Button
                type="submit"
                className="w-full h-12 text-base font-semibold mt-2"
                disabled={isLoading || !mobile.trim() || pin.join("").length < 4}
                style={{ backgroundColor: "#c8a43a", color: "#1e3a5f" }}
              >
                {isLoading ? "Signing in…" : "Sign In"}
              </Button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
