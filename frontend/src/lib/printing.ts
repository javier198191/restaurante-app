/**
 * Envía un trabajo de impresión a una impresora térmica Epson compatible con ePOS-Print XML.
 *
 * @param xml Contenido XML del ticket generado con buildTicketXML
 * @returns true si la impresión fue exitosa, false si hubo algún error de comunicación
 */
export async function sendPrintJob(xml: string): Promise<boolean> {
  try {
    const printerIp = import.meta.env.VITE_PRINTER_IP

    if (!printerIp) {
      throw new Error(
        'Error de configuración: La variable de entorno VITE_PRINTER_IP no está definida en el archivo .env.'
      )
    }

    // El protocolo ePOS-Print XML mediante HTTP POST (service.cgi) requiere envoltorio SOAP Envelope
    const soapPayload = xml.includes('<s:Envelope')
      ? xml
      : `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>${xml}</s:Body></s:Envelope>`

    // Endpoint estándar ePOS-Print XML
    const endpoint = `http://${printerIp}/cgi-bin/epos/service.cgi?devid=local_printer&timeout=10000`

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'If-Modified-Since': 'Thu, 01 Jan 1970 00:00:00 GMT',
        'SOAPAction': '""',
      },
      body: soapPayload,
    })

    if (!response.ok) {
      console.warn(
        `Impresora ePOS respondió con status HTTP no exitoso: ${response.status} ${response.statusText}`
      )
      return false
    }

    const responseText = await response.text()

    // El protocolo ePOS retorna un XML de respuesta con success="true" o success="false"
    if (responseText.includes('success="false"')) {
      console.warn('La impresora ePOS reportó fallo en el trabajo de impresión:', responseText)
      return false
    }

    return true
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Fallo en la comunicación con la impresora ePOS:', message)
    return false
  }
}
