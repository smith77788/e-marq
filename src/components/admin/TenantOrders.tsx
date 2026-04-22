import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, X, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";

type OrderRow = {
  id: string;
  status: "pending" | "paid" | "fulfilled" | "cancelled" | "refunded";
  payment_method: string;
  payment_ref: string | null;
  customer_email: string | null;
  customer_name: string | null;
  total_cents: number;
  currency: string;
  created_at: string;
  paid_at: string | null;
};

type OrderItemRow = {
  id: string;
  product_name: string;
  quantity: number;
  unit_price_cents: number;
};

type StatusFilter = "all" | OrderRow["status"];

export function TenantOrders({ tenantId }: { tenantId: string }) {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmingOrder, setConfirmingOrder] = useState<OrderRow | null>(null);
  const [paymentRef, setPaymentRef] = useState("");
  const [cancelingOrder, setCancelingOrder] = useState<OrderRow | null>(null);

  const ordersQuery = useQuery({
    queryKey: ["tenant-orders", tenantId, statusFilter],
    queryFn: async () => {
      let q = supabase
        .from("orders")
        .select(
          "id, status, payment_method, payment_ref, customer_email, customer_name, total_cents, currency, created_at, paid_at",
        )
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (statusFilter !== "all") {
        q = q.eq("status", statusFilter);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data as OrderRow[];
    },
  });

  const itemsQuery = useQuery({
    queryKey: ["tenant-order-items", tenantId, expandedId],
    enabled: !!expandedId,
    queryFn: async () => {
      if (!expandedId) return [];
      const { data, error } = await supabase
        .from("order_items")
        .select("id, product_name, quantity, unit_price_cents")
        .eq("order_id", expandedId);
      if (error) throw error;
      return data as OrderItemRow[];
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["tenant-orders", tenantId] });
    queryClient.invalidateQueries({ queryKey: ["tenant-orders-count", tenantId] });
    queryClient.invalidateQueries({ queryKey: ["tenant-products", tenantId] });
  };

  const markPaidMutation = useMutation({
    mutationFn: async ({ orderId, ref }: { orderId: string; ref: string }) => {
      const { error } = await supabase.rpc("mark_order_paid", {
        _order_id: orderId,
        _payment_ref: ref || undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Замовлення позначено оплаченим");
      setConfirmingOrder(null);
      setPaymentRef("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const { error } = await supabase.rpc("cancel_order", { _order_id: orderId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Замовлення скасовано");
      setCancelingOrder(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
        <div>
          <CardTitle>Замовлення</CardTitle>
          <CardDescription>
            Підтверджуйте оплати банком, скасовуйте замовлення та переглядайте історію.
          </CardDescription>
        </div>
        <div className="w-full sm:w-56">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Усі статуси</SelectItem>
              <SelectItem value="pending">Очікує оплату</SelectItem>
              <SelectItem value="paid">Оплачено</SelectItem>
              <SelectItem value="fulfilled">Відправлено</SelectItem>
              <SelectItem value="cancelled">Скасовано</SelectItem>
              <SelectItem value="refunded">Повернуто</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {ordersQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Завантаження…</p>
        ) : ordersQuery.data && ordersQuery.data.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Замовлення</TableHead>
                  <TableHead>Покупець</TableHead>
                  <TableHead>Спосіб оплати</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="text-right">Сума</TableHead>
                  <TableHead className="text-right">Дії</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ordersQuery.data.map((o) => {
                  const expanded = expandedId === o.id;
                  return (
                    <>
                      <TableRow key={o.id}>
                        <TableCell>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => setExpandedId(expanded ? null : o.id)}
                            aria-label={expanded ? "Згорнути" : "Розгорнути"}
                            aria-expanded={expanded}
                          >
                            {expanded ? (
                              <ChevronUp className="h-4 w-4" aria-hidden="true" />
                            ) : (
                              <ChevronDown className="h-4 w-4" aria-hidden="true" />
                            )}
                          </Button>
                        </TableCell>
                        <TableCell>
                          <div className="font-mono text-xs">#{o.id.slice(0, 8)}</div>
                          <div className="text-xs text-muted-foreground">
                            {new Date(o.created_at).toLocaleDateString()}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">{o.customer_email ?? "—"}</div>
                          {o.customer_name && (
                            <div className="text-xs text-muted-foreground">{o.customer_name}</div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            {o.payment_method === "manual" ? "Банк" : "Картка"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={o.status} />
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {(o.total_cents / 100).toFixed(2)} {o.currency}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            {o.status === "pending" && (
                              <>
                                <Button
                                  size="sm"
                                  variant="default"
                                  onClick={() => {
                                    setConfirmingOrder(o);
                                    setPaymentRef(o.payment_ref ?? "");
                                  }}
                                >
                                  <Check className="mr-1 h-3 w-3" />
                                  Підтвердити оплату
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setCancelingOrder(o)}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </>
                            )}
                            {o.status === "paid" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setCancelingOrder(o)}
                              >
                                Повернути / скасувати
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${o.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={7} className="py-3">
                            <div className="space-y-2">
                              <p className="text-xs font-semibold text-muted-foreground">
                                Товари у замовленні
                              </p>
                              {itemsQuery.isLoading ? (
                                <p className="text-xs text-muted-foreground">Завантаження…</p>
                              ) : itemsQuery.data && itemsQuery.data.length > 0 ? (
                                <ul className="space-y-1 text-sm">
                                  {itemsQuery.data.map((it) => (
                                    <li key={it.id} className="flex justify-between gap-3">
                                      <span>
                                        {it.product_name} × {it.quantity}
                                      </span>
                                      <span className="text-muted-foreground">
                                        {((it.unit_price_cents * it.quantity) / 100).toFixed(2)}{" "}
                                        {o.currency}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="text-xs text-muted-foreground">Товарів немає.</p>
                              )}
                              {o.payment_ref && (
                                <p className="text-xs text-muted-foreground">
                                  Номер платежу:{" "}
                                  <span className="font-mono text-foreground">{o.payment_ref}</span>
                                </p>
                              )}
                              {o.paid_at && (
                                <p className="text-xs text-muted-foreground">
                                  Оплачено: {new Date(o.paid_at).toLocaleString("uk-UA")}
                                </p>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Поки що замовлень немає.</p>
        )}
      </CardContent>

      {/* Confirm payment dialog */}
      <Dialog
        open={!!confirmingOrder}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmingOrder(null);
            setPaymentRef("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Підтвердити оплату цього замовлення?</DialogTitle>
            <DialogDescription>
              Замовлення №{confirmingOrder?.id.slice(0, 8)} — {confirmingOrder?.customer_email}
              <br />
              Сума: {confirmingOrder && (confirmingOrder.total_cents / 100).toFixed(2)}{" "}
              {confirmingOrder?.currency}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="payment-ref">Номер платежу (необовʼязково)</Label>
            <Input
              id="payment-ref"
              value={paymentRef}
              onChange={(e) => setPaymentRef(e.target.value)}
              placeholder="Номер банк. транзакції, чек тощо"
              disabled={markPaidMutation.isPending}
            />
            <p className="text-xs text-muted-foreground">
              Залишок товару зменшиться, замовлення піде у виконання.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmingOrder(null)}
              disabled={markPaidMutation.isPending}
            >
              Скасувати
            </Button>
            <Button
              onClick={() =>
                confirmingOrder &&
                markPaidMutation.mutate({ orderId: confirmingOrder.id, ref: paymentRef.trim() })
              }
              disabled={markPaidMutation.isPending}
            >
              {markPaidMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Так, оплачено
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel order */}
      <AlertDialog
        open={!!cancelingOrder}
        onOpenChange={(open) => !open && setCancelingOrder(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Скасувати це замовлення?</AlertDialogTitle>
            <AlertDialogDescription>
              Замовлення №{cancelingOrder?.id.slice(0, 8)}. Якщо воно було оплачене — залишок товару
              повернеться. Скасувати дію через інтерфейс пізніше не вийде.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelMutation.isPending}>Залишити</AlertDialogCancel>
            <AlertDialogAction
              disabled={cancelMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (cancelingOrder) cancelMutation.mutate(cancelingOrder.id);
              }}
            >
              {cancelMutation.isPending ? "Скасовую…" : "Так, скасувати"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function StatusBadge({ status }: { status: OrderRow["status"] }) {
  const map: Record<
    OrderRow["status"],
    { label: string; variant: "default" | "outline" | "secondary" | "destructive" }
  > = {
    pending: { label: "Очікує", variant: "secondary" },
    paid: { label: "Оплачено", variant: "default" },
    fulfilled: { label: "Відправлено", variant: "default" },
    cancelled: { label: "Скасовано", variant: "destructive" },
    refunded: { label: "Повернуто", variant: "destructive" },
  };
  const { label, variant } = map[status];
  return (
    <Badge variant={variant} className="text-[10px]">
      {label}
    </Badge>
  );
}
