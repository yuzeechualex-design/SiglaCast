<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:template match="/">
    <html>
      <head>
        <title>SiglaCast Event Report</title>
      </head>
      <body style="font-family: Arial; background:#f8fbff; color:#0d47a1;">
        <h2>SiglaCast Events</h2>
        <table border="1" cellpadding="8" cellspacing="0" style="background:#fff; border-color:#fbc02d;">
          <tr style="background:#0d47a1; color:#fff;">
            <th>ID</th>
            <th>Title</th>
            <th>Status</th>
            <th>Strategy</th>
          </tr>
          <xsl:for-each select="events/event">
            <tr>
              <td><xsl:value-of select="@id"/></td>
              <td><xsl:value-of select="title"/></td>
              <td><xsl:value-of select="status"/></td>
              <td><xsl:value-of select="strategy"/></td>
            </tr>
          </xsl:for-each>
        </table>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
