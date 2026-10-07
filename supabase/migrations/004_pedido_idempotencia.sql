-- Migración 004: Idempotencia y creación atómica de pedidos
-- PASO 1 — Columna de idempotencia
ALTER TABLE pedidos ADD COLUMN cliente_uuid UUID UNIQUE;

-- PASO 2 — Función atómica en Postgres
CREATE OR REPLACE FUNCTION crear_pedido_completo(
  cliente_uuid UUID,
  mesa_id BIGINT,
  usuario_id UUID,
  items JSONB
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_pedido_id BIGINT;
  v_item JSONB;
BEGIN
  -- 1. Si ya existe un pedido con ese cliente_uuid, devolver su id sin hacer nada más (evita duplicados en reintentos)
  SELECT id INTO v_pedido_id
  FROM pedidos
  WHERE pedidos.cliente_uuid = crear_pedido_completo.cliente_uuid;

  IF v_pedido_id IS NOT NULL THEN
    RETURN v_pedido_id;
  END IF;

  -- 2. Si no existe, insertar en pedidos
  INSERT INTO pedidos (cliente_uuid, mesa_id, usuario_id, estado)
  VALUES (crear_pedido_completo.cliente_uuid, crear_pedido_completo.mesa_id, crear_pedido_completo.usuario_id, 'abierto')
  RETURNING id INTO v_pedido_id;

  -- 3. Insertar cada item en detalle_pedido dentro de la misma transacción atómica
  IF items IS NOT NULL AND jsonb_typeof(items) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(items)
    LOOP
      INSERT INTO detalle_pedido (
        pedido_id,
        producto_id,
        cantidad,
        nota
      )
      VALUES (
        v_pedido_id,
        (v_item->>'producto_id')::BIGINT,
        COALESCE((v_item->>'cantidad')::INT, 1),
        v_item->>'nota'
      );
    END LOOP;
  END IF;

  -- 4. Devolver el id del pedido creado
  RETURN v_pedido_id;
END;
$$;
