-- Migración 006: Función atómica para cerrar mesa y cobrar pedido

-- Asegurar que la tabla pedidos tenga columna estado con default 'abierto'
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS estado TEXT DEFAULT 'abierto';

-- Función principal: recibe el id de la mesa, liquida el pedido activo y libera la mesa
CREATE OR REPLACE FUNCTION cerrar_mesa_y_cobrar(p_mesa_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_pedido_id BIGINT;
BEGIN
  -- 1. Encontrar el pedido activo de esa mesa (no marcado como pagado ni cerrado)
  SELECT id INTO v_pedido_id
  FROM pedidos
  WHERE mesa_id = p_mesa_id
    AND (estado IS NULL OR estado NOT IN ('pagado', 'cerrado'))
  ORDER BY id DESC
  LIMIT 1;

  -- 2. Cambiar el estado del pedido activo a 'cerrado'
  IF v_pedido_id IS NOT NULL THEN
    UPDATE pedidos
    SET estado = 'cerrado'
    WHERE id = v_pedido_id;
  END IF;

  -- 3. Cambiar el estado de la mesa a 'libre'
  UPDATE mesas
  SET estado = 'libre'
  WHERE id = p_mesa_id;

  -- 4. Devolver información del cierre atómico
  RETURN jsonb_build_object(
    'success', true,
    'pedido_id', v_pedido_id,
    'mesa_id', p_mesa_id,
    'estado_mesa', 'libre'
  );
END;
$$;

-- Sobrecarga compatible con texto si se invoca como string
CREATE OR REPLACE FUNCTION cerrar_mesa_y_cobrar(p_mesa_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  RETURN cerrar_mesa_y_cobrar(p_mesa_id::BIGINT);
END;
$$;
