import { trpc } from "@/lib/trpc";
import { localeMeta, t, type Locale, type TranslationKey } from "@/lib/i18n";
import { useState } from "react";
import { toast } from "sonner";
import {
  Input,
  PageFrame,
  Table,
  Status,
  Modal,
  FormFooter,
  EntityDocumentsButton,
} from "@/features/workspace/ui";
export function OrdersAndDeliveriesPage({
  locale,
  page,
}: {
  locale: Locale;
  page: "orders" | "deliveries";
}) {
  const t9 = (key: TranslationKey) => t(locale, key);
  const utils = trpc.useUtils();
  const orders = trpc.orders.list.useQuery();
  const deliveries = trpc.deliveries.list.useQuery();
  const suppliers = trpc.suppliers.list.useQuery();
  const contracts = trpc.contracts.list.useQuery();
  const requests = trpc.purchaseRequests.list.useQuery();
  const createOrder = trpc.orders.create.useMutation({
    onSuccess: () => {
      void utils.orders.list.invalidate();
      toast.success(t9("actionDone"));
    },
  });
  const createDelivery = trpc.deliveries.create.useMutation({
    onSuccess: () => {
      void utils.deliveries.list.invalidate();
      void utils.dashboard.overview.invalidate();
      toast.success(t9("actionDone"));
    },
  });
  const [open, setOpen] = useState(false);
  const [orderForm, setOrderForm] = useState({
    supplierId: "",
    requestId: "",
    contractId: "",
    totalAmount: "",
    deliveryLocation: "",
    terms: "",
  });
  const [deliveryForm, setDeliveryForm] = useState({
    poId: "",
    supplierId: "",
    deliveredValue: "",
    acceptedValue: "",
    rejectedValue: "",
    reference: "",
  });
  const isOrder = page === "orders";
  const rows = isOrder
    ? (orders.data ?? []).map(item => [
        item.poNumber,
        `SUPPLIER #${item.supplierId}`,
        `${item.totalAmount} ${item.currency}`,
        `${item.deliveredValue} / ${item.remainingValue}`,
        <Status key={item.id} value={item.status} />,
        <EntityDocumentsButton
          key={`${item.id}-docs`}
          entityType="purchase_order"
          entityId={item.id}
          t9={t9}
        />,
      ])
    : (deliveries.data ?? []).map(item => [
        item.deliveryNumber,
        item.deliveredValue,
        <Status key={item.id} value={item.status} />,
        new Date(item.createdAt).toLocaleDateString(
          localeMeta[locale].formatting
        ),
      ]);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (isOrder)
      createOrder.mutate(
        {
          supplierId: Number(orderForm.supplierId),
          requestId: orderForm.requestId
            ? Number(orderForm.requestId)
            : undefined,
          contractId: orderForm.contractId
            ? Number(orderForm.contractId)
            : undefined,
          totalAmount: Number(orderForm.totalAmount),
          deliveryLocation: orderForm.deliveryLocation || undefined,
          terms: orderForm.terms || undefined,
        },
        {
          onSuccess: () => setOpen(false),
          onError: error => toast.error(error.message),
        }
      );
    else
      createDelivery.mutate(
        {
          poId: Number(deliveryForm.poId),
          supplierId: Number(deliveryForm.supplierId),
          deliveredValue: Number(deliveryForm.deliveredValue),
          acceptedValue: Number(deliveryForm.acceptedValue || 0),
          rejectedValue: Number(deliveryForm.rejectedValue || 0),
          reference: deliveryForm.reference || undefined,
        },
        {
          onSuccess: () => setOpen(false),
          onError: error => toast.error(error.message),
        }
      );
  };
  return (
    <>
      <PageFrame
        locale={locale}
        title={page}
        action={() => setOpen(true)}
        actionLabel="create"
      >
        <Table
          headers={
            isOrder
              ? [
                  t9("number"),
                  t9("supplier"),
                  t9("value"),
                  "DELIVERED / REMAINING",
                  t9("status"),
                  t9("documents"),
                ]
              : [t9("number"), t9("value"), t9("status"), t9("created")]
          }
          rows={rows}
          empty={t9("noData")}
        />
      </PageFrame>
      {open ? (
        <Modal
          title={isOrder ? t9("orders") : t9("deliveries")}
          onClose={() => setOpen(false)}
        >
          <form onSubmit={submit} className="form-grid">
            {isOrder ? (
              <>
                <Input label={t9("supplier")} required>
                  <select
                    value={orderForm.supplierId}
                    onChange={e =>
                      setOrderForm({ ...orderForm, supplierId: e.target.value })
                    }
                    required
                  >
                    <option value="">—</option>
                    {(suppliers.data ?? []).map(item => (
                      <option key={item.id} value={item.id}>
                        {item.nameAr}
                      </option>
                    ))}
                  </select>
                </Input>
                <Input label={t9("value")} required>
                  <input
                    type="number"
                    min="0.01"
                    value={orderForm.totalAmount}
                    onChange={e =>
                      setOrderForm({
                        ...orderForm,
                        totalAmount: e.target.value,
                      })
                    }
                    required
                  />
                </Input>
                <Input label={t9("requests")}>
                  <select
                    value={orderForm.requestId}
                    onChange={e =>
                      setOrderForm({ ...orderForm, requestId: e.target.value })
                    }
                  >
                    <option value="">—</option>
                    {(requests.data ?? []).map(item => (
                      <option key={item.id} value={item.id}>
                        {item.requestNumber} — {item.title}
                      </option>
                    ))}
                  </select>
                </Input>
                <Input label={t9("contracts")}>
                  <select
                    value={orderForm.contractId}
                    onChange={e =>
                      setOrderForm({ ...orderForm, contractId: e.target.value })
                    }
                  >
                    <option value="">—</option>
                    {(contracts.data ?? []).map(item => (
                      <option key={item.id} value={item.id}>
                        {item.contractNumber} — {item.title}
                      </option>
                    ))}
                  </select>
                </Input>
                <Input label="DELIVERY//LOCATION">
                  <input
                    value={orderForm.deliveryLocation}
                    onChange={e =>
                      setOrderForm({
                        ...orderForm,
                        deliveryLocation: e.target.value,
                      })
                    }
                    dir="auto"
                  />
                </Input>
                <Input label="TERMS">
                  <textarea
                    value={orderForm.terms}
                    onChange={e =>
                      setOrderForm({ ...orderForm, terms: e.target.value })
                    }
                    dir="auto"
                  />
                </Input>
              </>
            ) : (
              <>
                <Input label="PO//ID" required>
                  <select
                    value={deliveryForm.poId}
                    onChange={e =>
                      setDeliveryForm({ ...deliveryForm, poId: e.target.value })
                    }
                    required
                  >
                    <option value="">—</option>
                    {(orders.data ?? []).map(item => (
                      <option key={item.id} value={item.id}>
                        {item.poNumber} — {item.remainingValue} remaining
                      </option>
                    ))}
                  </select>
                </Input>
                <Input label={t9("supplier")} required>
                  <select
                    value={deliveryForm.supplierId}
                    onChange={e =>
                      setDeliveryForm({
                        ...deliveryForm,
                        supplierId: e.target.value,
                      })
                    }
                    required
                  >
                    <option value="">—</option>
                    {(suppliers.data ?? []).map(item => (
                      <option key={item.id} value={item.id}>
                        {item.nameAr}
                      </option>
                    ))}
                  </select>
                </Input>
                <Input label="DELIVERED//VALUE" required>
                  <input
                    type="number"
                    min="0.01"
                    value={deliveryForm.deliveredValue}
                    onChange={e =>
                      setDeliveryForm({
                        ...deliveryForm,
                        deliveredValue: e.target.value,
                      })
                    }
                    required
                  />
                </Input>
                <Input label="ACCEPTED//VALUE">
                  <input
                    type="number"
                    min="0"
                    value={deliveryForm.acceptedValue}
                    onChange={e =>
                      setDeliveryForm({
                        ...deliveryForm,
                        acceptedValue: e.target.value,
                      })
                    }
                  />
                </Input>
                <Input label="REJECTED//VALUE">
                  <input
                    type="number"
                    min="0"
                    value={deliveryForm.rejectedValue}
                    onChange={e =>
                      setDeliveryForm({
                        ...deliveryForm,
                        rejectedValue: e.target.value,
                      })
                    }
                  />
                </Input>
                <Input label={t9("number")}>
                  <input
                    value={deliveryForm.reference}
                    onChange={e =>
                      setDeliveryForm({
                        ...deliveryForm,
                        reference: e.target.value,
                      })
                    }
                    dir="auto"
                  />
                </Input>
              </>
            )}
            <FormFooter
              t9={t9}
              pending={createOrder.isPending || createDelivery.isPending}
            />
          </form>
        </Modal>
      ) : null}
    </>
  );
}
