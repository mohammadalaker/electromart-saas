-- ربط تذكرة الصيانة بزبون الدليل (اختياري)
-- نفّذ بعد service_warranty_tickets.sql و store_contacts

ALTER TABLE public.service_warranty_tickets
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.store_contacts (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_service_tickets_contact ON public.service_warranty_tickets (contact_id)
  WHERE contact_id IS NOT NULL;

COMMENT ON COLUMN public.service_warranty_tickets.contact_id IS 'ربط اختياري بسجل زبون في store_contacts';
