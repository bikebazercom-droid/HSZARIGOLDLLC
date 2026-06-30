import React, { useState } from "react";
import { useAuth } from "@/context/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Lock, User } from "lucide-react";

export default function LoginPage() {
  const { login } = useAuth();
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;
    setIsLoading(true);
    try {
      await login(username.trim(), password.trim());
    } catch (err: any) {
      toast({ title: "Login failed", description: err.message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: "linear-gradient(135deg, #1e3a5f 0%, #0f2040 100%)" }}
    >
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div
            className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center text-2xl font-bold"
            style={{ backgroundColor: "#c8a43a", color: "#1e3a5f" }}
          >
            H
          </div>
          <h1 className="text-2xl font-bold text-white">Hazari Gold L.L.C</h1>
          <p className="text-blue-200 text-sm mt-1">Management Portal</p>
        </div>

        <Card className="border-0 shadow-2xl">
          <CardHeader className="pb-4">
            <CardTitle className="text-center text-primary">Sign In</CardTitle>
            <CardDescription className="text-center">Enter your credentials to access the system</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="username"
                    className="pl-9"
                    placeholder="Enter username"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    autoComplete="username"
                    autoFocus
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    className="pl-9"
                    placeholder="Enter password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                </div>
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={isLoading || !username.trim() || !password.trim()}
                style={{ backgroundColor: "#c8a43a", color: "#1e3a5f" }}
              >
                {isLoading ? "Signing in…" : "Sign In"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
