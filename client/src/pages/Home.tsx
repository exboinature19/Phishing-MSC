import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle, CheckCircle, Loader2, Zap, Upload, Settings, History, BarChart3, FileText, Shield, Clock, Search } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { predictPhishing, explainPhishing, parseCSV } from "@/lib/huggingface";

interface PredictionResult {
  model: string;
  label: string;
  confidence: number;
  f1_score: number;
  keywords?: string[];
  riskFactors?: string[];
}

interface BatchResult {
  emailIndex: number;
  emailPreview: string;
  predictions: PredictionResult[];
  isPhishing: boolean;
}

interface AnalysisHistoryItem {
  id: string;
  timestamp: number;
  emailPreview: string;
  isPhishing: boolean;
  avgConfidence: number;
}

const MODELS = [
  { name: "BERT", id: "bert", f1: 0.9831, description: "Highest accuracy (99.02%)" },
  { name: "RoBERTa", id: "roberta", f1: 0.9749, description: "Best recall (99.15%)" },
  { name: "DistilBERT", id: "distilbert", f1: 0.9808, description: "Fastest fine-tuned (9.93ms)" },
  { name: "Qwen2.5", id: "qwen", f1: 0.9675, description: "Large model variant" },
  { name: "DeepSeek", id: "deepseek", f1: 0.9650, description: "Large model variant" },
];

const MODEL_MAPPING: Record<string, string> = {
  bert: "Exboinature/phishguard-bert",
  roberta: "Exboinature/phishguard-roberta",
  distilbert: "Exboinature/phishguard-distilbert",
  qwen: "Exboinature/phishguard-qwen",
  deepseek: "Exboinature/phishguard-deepseek",
};

export default function Home() {
  const [emailText, setEmailText] = useState("");
  const [selectedModels, setSelectedModels] = useState<string[]>(["bert", "roberta", "distilbert"]);
  const [predictions, setPredictions] = useState<PredictionResult[]>([]);
  const [batchResults, setBatchResults] = useState<BatchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hfToken, setHfToken] = useState(import.meta.env.VITE_HF_TOKEN || "");
  const [showTokenInput, setShowTokenInput] = useState(!hfToken);
  const [activeTab, setActiveTab] = useState<"single" | "batch" | "history" | "report">("single");
  const [history, setHistory] = useState<AnalysisHistoryItem[]>([]);
  const [stats, setStats] = useState({ total:  5418, phishing: 1568, safe: 3850 });
  const fileInputRef = useRef<HTMLInputElement>(null);


  // COMMENT OUT THIS ENTIRE BLOCK TEMPORARILY
/*
useEffect(() => {
  const savedHistory = localStorage.getItem("phishguard_history");
  if (savedHistory) {
    setHistory(JSON.parse(savedHistory));
  }
  const savedStats = localStorage.getItem("phishguard_stats");
  if (savedStats) {
    setStats(JSON.parse(savedStats));
  }
}, []);
*/

  // Save history to localStorage
  useEffect(() => {
    localStorage.setItem("phishguard_history", JSON.stringify(history));
    localStorage.setItem("phishguard_stats", JSON.stringify(stats));
  }, [history, stats]);

  const toggleModel = (modelId: string) => {
    setSelectedModels((prev) =>
      prev.includes(modelId) ? prev.filter((m) => m !== modelId) : [...prev, modelId]
    );
  };

  const analyzeEmail = async () => {
    if (!emailText.trim()) {
      setError("Please enter email text to analyze");
      return;
    }

    setLoading(true);
    setError("");
    setPredictions([]);

    try {
      const results: PredictionResult[] = [];

      for (const modelId of selectedModels) {
        const modelName = MODELS.find((m) => m.id === modelId)?.name || modelId;
        const hfModelId = MODEL_MAPPING[modelId];

        try {
          const prediction = await predictPhishing(emailText, hfModelId, hfToken);
          const explanation = explainPhishing(emailText, prediction.label.toLowerCase() === "phishing");

          results.push({
            model: modelName,
            label: prediction.label,
            confidence: prediction.score,
            f1_score: MODELS.find((m) => m.id === modelId)?.f1 || 0,
            keywords: explanation.keywords,
            riskFactors: explanation.riskFactors,
          });
        } catch (err) {
          console.error(`Error with ${modelName}:`, err);
          results.push({
            model: modelName,
            label: "error",
            confidence: 0,
            f1_score: MODELS.find((m) => m.id === modelId)?.f1 || 0,
          });
        }
      }

      setPredictions(results);
      
      // Update history and stats
      const isPhish = results.some(p => p.label.toLowerCase() === "phishing");
      const avgConf = results.reduce((sum, p) => sum + p.confidence, 0) / results.length;
      
      const newHistoryItem: AnalysisHistoryItem = {
        id: Date.now().toString(),
        timestamp: Date.now(),
        emailPreview: emailText.substring(0, 100),
        isPhishing: isPhish,
        avgConfidence: avgConf * 100
      };
      
      setHistory(prev => [newHistoryItem, ...prev].slice(0, 10));
      setStats(prev => ({
        total: prev.total + 1,
        phishing: isPhish ? prev.phishing + 1 : prev.phishing,
        safe: !isPhish ? prev.safe + 1 : prev.safe
      }));

    } catch (err) {
      setError("Failed to analyze email. Please try again.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleBatchUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError("");
    setBatchResults([]);

    try {
      const text = await file.text();
      const emails = parseCSV(text);

      if (emails.length === 0) {
        setError("No emails found in CSV file");
        setLoading(false);
        return;
      }

      const results: BatchResult[] = [];

      for (let i = 0; i < emails.length; i++) {
        const emailContent = emails[i];
        const predictions: PredictionResult[] = [];
        let isPhishing = false;

        for (const modelId of selectedModels) {
          const modelName = MODELS.find((m) => m.id === modelId)?.name || modelId;
          const hfModelId = MODEL_MAPPING[modelId];

          try {
            const prediction = await predictPhishing(emailContent, hfModelId, hfToken);
            const explanation = explainPhishing(emailContent, prediction.label.toLowerCase() === "phishing");

            if (prediction.label.toLowerCase() === "phishing") {
              isPhishing = true;
            }

            predictions.push({
              model: modelName,
              label: prediction.label,
              confidence: prediction.score,
              f1_score: MODELS.find((m) => m.id === modelId)?.f1 || 0,
              keywords: explanation.keywords,
              riskFactors: explanation.riskFactors,
            });
          } catch (err) {
            console.error(`Error with ${modelName}:`, err);
            predictions.push({
              model: modelName,
              label: "error",
              confidence: 0,
              f1_score: MODELS.find((m) => m.id === modelId)?.f1 || 0,
            });
          }
        }

        results.push({
          emailIndex: i + 1,
          emailPreview: emailContent.substring(0, 100),
          predictions,
          isPhishing,
        });
        
        // Update stats for each email in batch
        setStats(prev => ({
          total: prev.total + 1,
          phishing: isPhishing ? prev.phishing + 1 : prev.phishing,
          safe: !isPhishing ? prev.safe + 1 : prev.safe
        }));
      }

      setBatchResults(results);
    } catch (err) {
      setError("Failed to process CSV file. Please check the format.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const isPhishing = predictions.some((p) => p.label.toLowerCase() === "phishing");
  const avgConfidence =
    predictions.length > 0
      ? (predictions.reduce((sum, p) => sum + p.confidence, 0) / predictions.length) * 100
      : 0;

  const getModelButtonClass = (modelId: string) => {
    const isSelected = selectedModels.includes(modelId);
    return isSelected
      ? "border-primary bg-primary/10 text-primary"
      : "border-border bg-background text-foreground hover:border-primary/50";
  };

  const getProgressBarColor = (isPhish: boolean) => {
    return isPhish ? "bg-destructive" : "bg-accent";
  };

  const getPredictionBadgeClass = (label: string) => {
    const lowerLabel = label.toLowerCase();
    if (lowerLabel === "phishing") {
      return "bg-destructive/20 text-destructive";
    } else if (lowerLabel === "safe") {
      return "bg-accent/20 text-accent";
    } else {
      return "bg-muted text-muted-foreground";
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <section className="relative w-full h-80 bg-cover bg-center flex items-center justify-center overflow-hidden" style={{ backgroundImage: `url('https://d2xsxph8kpxj0f.cloudfront.net/310519663231718115/BFYQUNDowFEW2Zy7Apmf9g/phishguard-hero-aAHYZDD4UAzFQJ7jsyUYAi.webp')` }}>
        <div className="absolute inset-0 bg-gradient-to-r from-primary/90 to-primary/70" />
        <div className="relative z-10 text-center text-white">
          <h1 className="text-5xl font-bold mb-4">PhishGuard AI</h1>
          <p className="text-xl opacity-90">Advanced Email Phishing Detection System</p>
        </div>
      </section>

      <div className="container mx-auto py-8 px-4">
        {/* Stats Bar */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <Card className="p-4 flex items-center gap-4 bg-card shadow-sm">
            <div className="p-3 bg-primary/10 rounded-full text-primary"><Search className="w-6 h-6" /></div>
            <div>
              <div className="text-2xl font-bold">{stats.total}</div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Total Analysed</div>
            </div>
          </Card>
          <Card className="p-4 flex items-center gap-4 bg-card shadow-sm">
            <div className="p-3 bg-destructive/10 rounded-full text-destructive"><AlertCircle className="w-6 h-6" /></div>
            <div>
              <div className="text-2xl font-bold">{stats.phishing}</div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Phishing Detected</div>
            </div>
          </Card>
          <Card className="p-4 flex items-center gap-4 bg-card shadow-sm">
            <div className="p-3 bg-accent/10 rounded-full text-accent"><Shield className="w-6 h-6" /></div>
            <div>
              <div className="text-2xl font-bold">{stats.safe}</div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Safe Emails</div>
            </div>
          </Card>
        </div>

        <div className="flex flex-wrap gap-2 mb-8 border-b border-border pb-4">
          <Button onClick={() => setActiveTab("single")} variant={activeTab === "single" ? "default" : "ghost"} className={activeTab === "single" ? "bg-primary" : ""}>
            <Zap className="w-4 h-4 mr-2" /> Single Analysis
          </Button>
          <Button onClick={() => setActiveTab("batch")} variant={activeTab === "batch" ? "default" : "ghost"} className={activeTab === "batch" ? "bg-primary" : ""}>
            <Upload className="w-4 h-4 mr-2" /> Batch Upload
          </Button>
          <Button onClick={() => setActiveTab("history")} variant={activeTab === "history" ? "default" : "ghost"} className={activeTab === "history" ? "bg-primary" : ""}>
            <History className="w-4 h-4 mr-2" /> Recent History
          </Button>
          <Button onClick={() => setActiveTab("report")} variant={activeTab === "report" ? "default" : "ghost"} className={activeTab === "report" ? "bg-primary" : ""}>
            <FileText className="w-4 h-4 mr-2" /> Research Report
          </Button>
        </div>

        <AnimatePresence mode="wait">
          {activeTab === "single" && (
            <motion.div key="single" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2">
                <Card className="p-8 shadow-lg">
                  <h2 className="text-2xl font-bold mb-6 text-foreground">Analyze Email</h2>
                  <div className="mb-6">
                    <label className="block text-sm font-medium mb-3 text-foreground">Email Content</label>
                    <Textarea placeholder="Paste the email text here to analyze for phishing..." value={emailText} onChange={(e) => setEmailText(e.target.value)} className="min-h-40 resize-none" />
                  </div>
                  <div className="mb-6">
                    <label className="block text-sm font-medium mb-3 text-foreground">Select Models to Compare</label>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {MODELS.map((model) => (
                        <motion.button key={model.id} onClick={() => toggleModel(model.id)} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className={`p-3 rounded-lg border-2 text-left transition-all ${getModelButtonClass(model.id)}`}>
                          <div className="font-semibold text-sm">{model.name}</div>
                          <div className="text-[10px] opacity-75 leading-tight mt-1">{model.description}</div>
                        </motion.button>
                      ))}
                    </div>
                  </div>
                  {error && <div className="mb-6 p-4 bg-destructive/10 border border-destructive/30 rounded-lg text-destructive text-sm">{error}</div>}
                  <Button onClick={analyzeEmail} disabled={loading || !emailText.trim()} className="w-full h-12 text-base font-semibold bg-primary hover:bg-primary/90">
                    {loading ? (<><Loader2 className="mr-2 h-5 w-5 animate-spin" />Analyzing with {selectedModels.length} models...</>) : (<><Zap className="mr-2 h-5 w-5" />Analyze Email</>)}
                  </Button>
                </Card>
              </div>
              <div className="lg:col-span-1">
                {predictions.length > 0 && (
                  <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
                    <Card className="p-6 shadow-lg bg-card border-0">
                      <div className="mb-6 text-center">
                        {isPhishing ? (
                          <div className="p-4 bg-destructive/10 rounded-xl">
                            <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-2" />
                            <h3 className="text-xl font-bold text-destructive">PHISHING DETECTED</h3>
                          </div>
                        ) : (
                          <div className="p-4 bg-accent/10 rounded-xl">
                            <CheckCircle className="w-12 h-12 text-accent mx-auto mb-2" />
                            <h3 className="text-xl font-bold text-accent">SAFE EMAIL</h3>
                          </div>
                        )}
                      </div>
                      <div className="mb-6">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-muted-foreground">Avg. Confidence</span>
                          <span className="text-sm font-bold text-primary">{avgConfidence.toFixed(1)}%</span>
                        </div>
                        <div className="w-full h-2 bg-border rounded-full overflow-hidden">
                          <motion.div initial={{ width: 0 }} animate={{ width: `${avgConfidence}%` }} transition={{ duration: 1 }} className={`h-full ${getProgressBarColor(isPhishing)}`} />
                        </div>
                      </div>
                      <div className="space-y-4">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Model Breakdown</h4>
                        {predictions.map((pred) => (
                          <div key={pred.model} className="p-3 bg-secondary/30 rounded-lg border border-border/50">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-semibold">{pred.model}</span>
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${getPredictionBadgeClass(pred.label)}`}>{pred.label.toUpperCase()}</span>
                            </div>
                            <div className="text-[10px] text-muted-foreground">{(pred.confidence * 100).toFixed(1)}% confidence</div>
                          </div>
                        ))}
                      </div>
                    </Card>
                  </motion.div>
                )}
              </div>
            </motion.div>
          )}

          {activeTab === "batch" && (
            <motion.div key="batch" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <Card className="p-8 shadow-lg">
                <h2 className="text-2xl font-bold mb-6 text-foreground">Batch Email Analysis</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div>
                    <div className="border-2 border-dashed border-primary/30 rounded-xl p-10 text-center cursor-pointer hover:bg-primary/5 transition-colors mb-6" onClick={() => fileInputRef.current?.click()}>
                      <Upload className="w-12 h-12 text-primary mx-auto mb-4" />
                      <h3 className="text-lg font-semibold mb-2">Upload CSV File</h3>
                      <p className="text-sm text-muted-foreground mb-4">Upload a CSV file with email content</p>
                      <Button className="bg-primary hover:bg-primary/90">Choose File</Button>
                      <input ref={fileInputRef} type="file" accept=".csv" onChange={handleBatchUpload} className="hidden" />
                    </div>
                    <div className="space-y-4">
                      <h3 className="text-sm font-semibold">Selected Models</h3>
                      <div className="flex flex-wrap gap-2">
                        {MODELS.map(m => (
                          <span key={m.id} className={`px-3 py-1 rounded-full text-xs font-medium border ${selectedModels.includes(m.id) ? "bg-primary/10 border-primary text-primary" : "bg-secondary border-border text-muted-foreground"}`}>
                            {m.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div>
                    {loading && (
                      <div className="flex flex-col items-center justify-center h-full py-10">
                        <Loader2 className="w-10 h-10 animate-spin text-primary mb-4" />
                        <p className="text-lg font-medium">Processing Batch...</p>
                        <p className="text-sm text-muted-foreground">Analyzing emails sequentially with model variance</p>
                      </div>
                    )}
                    {batchResults.length > 0 && (
                      <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
                        {batchResults.map((result) => (
                          <div key={result.emailIndex} className="p-4 bg-secondary/50 rounded-lg border border-border">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-bold">Email #{result.emailIndex}</span>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${result.isPhishing ? "bg-destructive/20 text-destructive" : "bg-accent/20 text-accent"}`}>
                                {result.isPhishing ? "PHISHING" : "SAFE"}
                              </span>
                            </div>
                            <p className="text-[10px] text-muted-foreground line-clamp-1 mb-2 italic">"{result.emailPreview}..."</p>
                            <div className="grid grid-cols-3 gap-2">
                              {result.predictions.map(p => (
                                <div key={p.model} className="text-[9px] flex flex-col">
                                  <span className="text-muted-foreground">{p.model}</span>
                                  <span className={p.label === "phishing" ? "text-destructive font-bold" : "text-accent font-bold"}>{(p.confidence * 100).toFixed(0)}%</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            </motion.div>
          )}

          {activeTab === "history" && (
            <motion.div key="history" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <Card className="p-8 shadow-lg">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-2xl font-bold text-foreground">Recent Analysis History</h2>
                  <Button variant="outline" size="sm" onClick={() => { setHistory([]); setStats({ total: 0, phishing: 0, safe: 0 }); }}>Clear History</Button>
                </div>
                {history.length === 0 ? (
                  <div className="text-center py-20 bg-secondary/20 rounded-xl border border-dashed border-border">
                    <Clock className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-20" />
                    <p className="text-muted-foreground">No recent analyses found. Start by analyzing an email.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {history.map((item) => (
                      <div key={item.id} className="flex items-center justify-between p-4 bg-card border border-border rounded-xl hover:shadow-md transition-shadow">
                        <div className="flex-1 min-w-0 mr-4">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`w-2 h-2 rounded-full ${item.isPhishing ? "bg-destructive" : "bg-accent"}`} />
                            <span className="text-xs font-bold text-muted-foreground">{new Date(item.timestamp).toLocaleString()}</span>
                          </div>
                          <p className="text-sm text-foreground truncate italic">"{item.emailPreview}..."</p>
                        </div>
                        <div className="text-right">
                          <div className={`text-xs font-bold mb-1 ${item.isPhishing ? "text-destructive" : "text-accent"}`}>
                            {item.isPhishing ? "PHISHING" : "SAFE"}
                          </div>
                          <div className="text-[10px] text-muted-foreground">{item.avgConfidence.toFixed(1)}% confidence</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </motion.div>
          )}

          {activeTab === "report" && (
            <motion.div key="report" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <Card className="p-8 shadow-lg max-h-[800px] overflow-y-auto">
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <h1 className="text-3xl font-bold mb-6 border-b pb-4">Executive Summary: LLM Phishing Evaluation</h1>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                    <div className="bg-primary/5 p-6 rounded-xl border border-primary/10">
                      <h3 className="text-primary font-bold mb-4 flex items-center gap-2"><BarChart3 className="w-5 h-5" /> Key Findings</h3>
                      <ul className="space-y-2 text-sm">
                        <li><strong>BERT:</strong> Highest confirmed F1 of 0.9831 and accuracy of 99.02%.</li>
                        <li><strong>DistilBERT:</strong> Best speed-accuracy trade-off (9.93ms per email).</li>
                        <li><strong>RoBERTa:</strong> Highest recall at 99.15%, missing the fewest phishing emails.</li>
                        <li><strong>FFNN Frozen:</strong> Extremely fast (0.02ms) and nearly matches fine-tuned performance.</li>
                      </ul>
                    </div>
                    <div className="bg-accent/5 p-6 rounded-xl border border-accent/10">
                      <h3 className="text-accent font-bold mb-4 flex items-center gap-2"><Shield className="w-5 h-5" /> Recommendations</h3>
                      <ul className="space-y-2 text-sm">
                        <li><strong>High Volume:</strong> Use FFNN frozen RoBERTa or DistilBERT.</li>
                        <li><strong>Max Accuracy:</strong> Deploy fine-tuned BERT or DistilBERT.</li>
                        <li><strong>Security-First:</strong> Deploy fine-tuned RoBERTa for maximum recall.</li>
                        <li><strong>Avoid:</strong> 7B models in frozen mode underperform significantly.</li>
                      </ul>
                    </div>
                  </div>

                  <h2 className="text-xl font-bold mt-8 mb-4">Performance Metrics</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="bg-secondary">
                          <th className="border p-2 text-left">Model</th>
                          <th className="border p-2 text-center">Accuracy</th>
                          <th className="border p-2 text-center">Recall</th>
                          <th className="border p-2 text-center">F1 Score</th>
                          <th className="border p-2 text-center">Latency</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr><td className="border p-2 font-medium">BERT (Fine-tuned)</td><td className="border p-2 text-center">99.02%</td><td className="border p-2 text-center">98.72%</td><td className="border p-2 text-center">0.9831</td><td className="border p-2 text-center">17.39ms</td></tr>
                        <tr><td className="border p-2 font-medium">DistilBERT (Fine-tuned)</td><td className="border p-2 text-center">98.89%</td><td className="border p-2 text-center">97.87%</td><td className="border p-2 text-center">0.9808</td><td className="border p-2 text-center">9.93ms</td></tr>
                        <tr><td className="border p-2 font-medium">RoBERTa (Fine-tuned)</td><td className="border p-2 text-center">98.52%</td><td className="border p-2 text-center">99.15%</td><td className="border p-2 text-center">0.9749</td><td className="border p-2 text-center">17.20ms</td></tr>
                        <tr className="bg-secondary/30"><td className="border p-2 font-medium">RoBERTa + FFNN</td><td className="border p-2 text-center">98.77%</td><td className="border p-2 text-center">97.45%</td><td className="border p-2 text-center">0.9786</td><td className="border p-2 text-center">0.02ms</td></tr>
                      </tbody>
                    </table>
                  </div>

                  <h2 className="text-xl font-bold mt-8 mb-4">Error Analysis</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <h4 className="font-bold text-destructive mb-2">False Negatives (Missed)</h4>
                      <p className="text-xs text-muted-foreground">Phishing emails using unusually formal language or corporate mimicry. Short email bodies with insufficient context.</p>
                    </div>
                    <div>
                      <h4 className="font-bold text-accent mb-2">False Positives (Flagged)</h4>
                      <p className="text-xs text-muted-foreground">Promotional marketing with urgency language. Legitimate account verification emails mirroring phishing templates.</p>
                    </div>
                  </div>
                </div>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="p-6 border-t-4 border-t-primary">
            <h3 className="text-lg font-semibold mb-2 text-foreground">Realistic Simulation</h3>
            <p className="text-sm text-muted-foreground">Experience model disagreement, variable network delays, and sophisticated confidence scoring.</p>
          </Card>
          <Card className="p-6 border-t-4 border-t-accent">
            <h3 className="text-lg font-semibold mb-2 text-foreground">Data-Driven Insights</h3>
            <p className="text-sm text-muted-foreground">Based on confirmed research results from BERT, RoBERTa, and DistilBERT training runs.</p>
          </Card>
          <Card className="p-6 border-t-4 border-t-destructive">
            <h3 className="text-lg font-semibold mb-2 text-foreground">Security First</h3>
            <p className="text-sm text-muted-foreground">Optimized for high recall to ensure maximum protection against sophisticated phishing attempts.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
