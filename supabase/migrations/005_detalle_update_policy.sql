CREATE POLICY "Cajero marca impreso" ON detalle_pedido
FOR UPDATE TO authenticated
USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('cajero', 'admin'));
