import type { Project } from './schema';
export const demoCode=`// Trace example · Mega 2560 Rev3
// Document external wiring; USB does not discover it.
constexpr uint8_t LED_PIN = 13;
constexpr unsigned long INTERVAL_MS = 350;

void setup() {
  pinMode(LED_PIN, OUTPUT);
  Serial.begin(115200);
  Serial.println("Trace: indicator ready");
}

void loop() {
  digitalWrite(LED_PIN, HIGH);
  Serial.println("indicator ON");
  delay(INTERVAL_MS);
  digitalWrite(LED_PIN, LOW);
  Serial.println("indicator OFF");
  delay(INTERVAL_MS);
}
`;
export function exampleProject():Project {return {schemaVersion:1,id:'indicator-demo',name:'Indicator / Mega 2560',revision:0,
 components:[{id:'board',partId:'arduino-mega-r3',partVersion:1,ref:'U1',config:{}},{id:'resistor',partId:'vishay-mrs25-330',partVersion:1,ref:'R1',config:{}},{id:'led',partId:'kingbright-wp7113id',partVersion:1,ref:'D1',config:{label:'Status indicator'}}],
 wires:[{id:'signal',from:{componentId:'board',terminalId:'d13'},to:{componentId:'resistor',terminalId:'p1'},color:'mint'},{id:'led-feed',from:{componentId:'resistor',terminalId:'p2'},to:{componentId:'led',terminalId:'a'},color:'mint'},{id:'return',from:{componentId:'led',terminalId:'k'},to:{componentId:'board',terminalId:'gnd1'},color:'gray'}],
 layouts:{wiring:{board:{x:40,y:80,rotation:0},resistor:{x:260,y:530,rotation:0},led:{x:570,y:480,rotation:0}},schematic:{board:{x:40,y:80,rotation:0},resistor:{x:260,y:530,rotation:0},led:{x:570,y:480,rotation:0}}},
 files:[{id:'main',path:'sketch.ino',content:demoCode}],bindings:[{id:'indicator-pin',boardId:'board',terminalId:'d13',target:{componentId:'resistor',terminalId:'p1'},fileId:'main',symbol:'LED_PIN',mode:'output'}],targetBoardId:'board'};}
export function blankProject():Project{return {schemaVersion:1,id:`project-${Date.now()}`,name:'Untitled project',revision:0,components:[],wires:[],layouts:{wiring:{},schematic:{}},files:[{id:'main',path:'sketch.ino',content:'void setup() {\n}\n\nvoid loop() {\n}\n'}],bindings:[],targetBoardId:null};}
