import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, KeyRound } from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/context/auth";

interface StaffUser {
  id: number;
  username: string;
  fullName: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`/api${path}`, {
    ...opts,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error ?? "Request failed");
  }
  return res.status === 204 ? null : res.json();
}

export default function AdminUsersPanel() {
  const { user: me } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editUser, setEditUser] = useState<StaffUser | null>(null);

  const [form, setForm] = useState({ fullName: "", username: "", password: "", role: "staff" });

  const load = async () => {
    setIsLoading(true);
    try {
      const data = await apiFetch("/admin/users");
      setUsers(data);
    } catch (e: any) {
      toast({ title: "Failed to load users", description: e.message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditUser(null);
    setForm({ fullName: "", username: "", password: "", role: "staff" });
    setDialogOpen(true);
  };

  const openEdit = (u: StaffUser) => {
    setEditUser(u);
    setForm({ fullName: u.fullName, username: u.username, password: "", role: u.role });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    try {
      if (editUser) {
        const body: Record<string, unknown> = { fullName: form.fullName, role: form.role };
        if (form.password) body.password = form.password;
        await apiFetch(`/admin/users/${editUser.id}`, { method: "PUT", body: JSON.stringify(body) });
        toast({ title: "User updated" });
      } else {
        if (!form.username || !form.password || !form.fullName) {
          toast({ title: "All fields are required", variant: "destructive" });
          return;
        }
        await apiFetch("/admin/users", { method: "POST", body: JSON.stringify(form) });
        toast({ title: "Staff account created" });
      }
      setDialogOpen(false);
      load();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleToggleActive = async (u: StaffUser) => {
    try {
      await apiFetch(`/admin/users/${u.id}`, {
        method: "PUT",
        body: JSON.stringify({ isActive: !u.isActive }),
      });
      load();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleDelete = async (u: StaffUser) => {
    if (!confirm(`Delete user "${u.fullName}"? This cannot be undone.`)) return;
    try {
      await apiFetch(`/admin/users/${u.id}`, { method: "DELETE" });
      toast({ title: "User deleted" });
      load();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold">Staff Accounts</h3>
          <p className="text-sm text-muted-foreground">Manage who can access the system and their permissions.</p>
        </div>
        <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" /> New Staff Account</Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Username</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
            ) : users.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No users found.</TableCell></TableRow>
            ) : users.map(u => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.fullName}</TableCell>
                <TableCell className="font-mono text-sm">{u.username}</TableCell>
                <TableCell>
                  <Badge variant={u.role === "admin" ? "default" : "secondary"}>
                    {u.role === "admin" ? "Admin" : "Staff"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={u.isActive}
                      onCheckedChange={() => handleToggleActive(u)}
                      disabled={u.id === me?.id}
                    />
                    <span className="text-sm">{u.isActive ? "Active" : "Inactive"}</span>
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {format(new Date(u.createdAt), "MMM d, yyyy")}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(u)} title="Edit">
                      <Pencil className="w-4 h-4" />
                    </Button>
                    {u.id !== me?.id && (
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(u)} title="Delete" className="text-destructive hover:text-destructive">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editUser ? "Edit User" : "New Staff Account"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Full Name *</Label>
              <Input value={form.fullName} onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))} placeholder="e.g. Ahmed Al Rashid" />
            </div>
            <div className="space-y-2">
              <Label>Username *</Label>
              <Input
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                placeholder="e.g. ahmed"
                disabled={!!editUser}
              />
              {editUser && <p className="text-xs text-muted-foreground">Username cannot be changed after creation.</p>}
            </div>
            <div className="space-y-2">
              <Label>{editUser ? "New Password (leave blank to keep current)" : "Password *"}</Label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type="password"
                  className="pl-9"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  placeholder={editUser ? "Leave blank to keep current" : "Set a password"}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={form.role} onValueChange={v => setForm(f => ({ ...f, role: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="staff">Staff (Invoice creation only)</SelectItem>
                  <SelectItem value="admin">Admin (Full access)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>{editUser ? "Save Changes" : "Create Account"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
