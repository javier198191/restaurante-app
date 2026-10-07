-- Migración 007: Corrección de tipo de dato y permisos para cerrar_mesa_y_cobrar

-- 1. Eliminar versiones anteriores con firmas incorrectas
DROP FUNCTION IF EXISTS cerrar_mesa_y_cobrar(uuid);
DROP FUNCTION IF EXISTS cerrar_mesa_y_cobrar(text);
DROP FUNCTION IF EXISTS cerrar_mesa_y_cobrar(bigint);

-- 2. Asegurar que la tabla pedidos tenga la columna estado
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS estado TEXT DEFAULT 'abierto';

-- 3. Crear la función con BIGINT y SECURITY DEFINER para saltar restricciones RLS
CREATE OR REPLACE FUNCTION cerrar_mesa_y_cobrar(p_mesa_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pedido_id BIGINT;
BEGIN
  -- 1. Encontrar el pedido activo de esa mesa (el que no esté marcado como pagado/cerrado)
  SELECT id INTO v_pedido_id
  FROM pedidos
  WHERE mesa_id = p_mesa_id
    AND (estado IS NULL OR estado NOT IN ('pagado', 'cerrado'))
  ORDER BY id DESC
  LIMIT 1;

  -- 2. Cambiar el estado del pedido a 'cerrado'
  IF v_pedido_id IS NOT NULL THEN
    UPDATE pedidos
    SET estado = 'cerrado'
    WHERE id = v_pedido_id;
  END IF;

  -- 3. Cambiar el estado de la mesa a 'libre'
  UPDATE mesas
  SET estado = 'libre'
  WHERE id = p_mesa_id;

  -- 4. Devolver resultado informativo
  RETURN jsonb_build_object(
    'success', true,
    'pedido_id', v_pedido_id,
    'mesa_id', p_mesa_id,
    'estado_mesa', 'libre'
  );
END;
$$;

-- 4. Sobrecarga auxiliar si se envía como texto/string desde algún cliente
CREATE OR REPLACE FUNCTION cerrar_mesa_y_cobrar(p_mesa_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN cerrar_mesa_y_cobrar(p_mesa_id::BIGINT);
END;
$$;

-- 5. Otorgar permisos de ejecución para roles autenticados y anónimos
GRANT EXECUTE ON FUNCTION cerrar_mesa_y_cobrar(BIGINT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION cerrar_mesa_y_cobrar(TEXT) TO authenticated, anon;

