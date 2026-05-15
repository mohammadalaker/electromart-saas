-- سياسات Storage لـ bucket صور المنتجات (Pic_of_items) — يطابق STORAGE_BUCKET في supabaseClient.js
-- نفّذ في Supabase SQL Editor بعد إنشاء الـ bucket بنفس الاسم.
--
-- القراءة عامة: الصور تُعرض في المتجر العام والواجهة (روابط عامة).
-- الرفع/التعديل/الحذف: فقط ضمن مجلد store_id المملوك للمستخدم.

INSERT INTO storage.buckets (id, name, public)
VALUES ('Pic_of_items', 'Pic_of_items', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "pic_items_public_read" ON storage.objects;
CREATE POLICY "pic_items_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'Pic_of_items');

DROP POLICY IF EXISTS "pic_items_insert_own_store" ON storage.objects;
CREATE POLICY "pic_items_insert_own_store"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'Pic_of_items'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.stores WHERE owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "pic_items_update_own_store" ON storage.objects;
CREATE POLICY "pic_items_update_own_store"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'Pic_of_items'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.stores WHERE owner_id = auth.uid()
    )
  )
  WITH CHECK (
    bucket_id = 'Pic_of_items'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.stores WHERE owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "pic_items_delete_own_store" ON storage.objects;
CREATE POLICY "pic_items_delete_own_store"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'Pic_of_items'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.stores WHERE owner_id = auth.uid()
    )
  );
