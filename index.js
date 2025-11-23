import Dende from "./dist/index.js"

let dende = new Dende(800, 600)
dende.getHTMLElement().style.backgroundColor = "cyan"
document.body.appendChild(dende.getHTMLElement())

let dende2 = new Dende(800, 600)
dende2.getHTMLElement().style.backgroundColor = "red"
document.body.appendChild(dende2.getHTMLElement())
dende.setDrawingMode("drawing")
dende.setLineColorRGBA(0,0,255,1)
dende.setLineWidth(10)
dende.partListeners.push((part)=>{dende2.putPart(part)})
dende2.disableDrawing()
dende.setFPS(20)
