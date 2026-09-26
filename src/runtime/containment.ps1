param([Parameter(Mandatory=$true)][string]$Spec)
$ErrorActionPreference = 'Stop'
$s = Get-Content -LiteralPath $Spec -Raw | ConvertFrom-Json
Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
public static class CcaJob {
  [StructLayout(LayoutKind.Sequential)] struct STARTUPINFO {
    public int cb; public string reserved, desktop, title;
    public int x,y,xsize,ysize,xchars,ychars,fill,flags;
    public short show,reserved2; public IntPtr reserved3,input,output,error;
  }
  [StructLayout(LayoutKind.Sequential)] struct PROCESSINFO { public IntPtr process,thread; public int pid,tid; }
  [StructLayout(LayoutKind.Sequential)] struct BASICLIMIT {
    public long processTime,jobTime; public uint flags; public UIntPtr min,max; public uint active;
    public UIntPtr affinity; public uint priority,scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct IOCOUNTERS { public ulong a,b,c,d,e,f; }
  [StructLayout(LayoutKind.Sequential)] struct EXTENDEDLIMIT {
    public BASICLIMIT basic; public IOCOUNTERS io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int type,IntPtr data,uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int which);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string app,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref STARTUPINFO start,out PROCESSINFO info);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr handle,out uint code);
  static string Quote(string arg) {
    var b=new StringBuilder("\""); int slashes=0;
    foreach(char c in arg) { if(c=='\\') { slashes++; continue; }
      if(c=='"') { b.Append('\\',slashes*2+1); b.Append(c); slashes=0; continue; }
      b.Append('\\',slashes); slashes=0; b.Append(c);
    }
    b.Append('\\',slashes*2); return b.Append('"').ToString();
  }
  static bool Alive(int pid,string ticks) {
    try { var p=Process.GetProcessById(pid); return !p.HasExited && p.StartTime.ToUniversalTime().Ticks.ToString()==ticks; } catch { return false; }
  }
  public static int Run(string exe,string[] args,string cwd,int owner,string ownerStart,string cancel,string registry) {
    IntPtr job=CreateJobObject(IntPtr.Zero,null); if(job==IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
    PROCESSINFO pi=new PROCESSINFO(); bool started=false;
    try {
      var limits=new EXTENDEDLIMIT(); limits.basic.flags=0x2000; // KILL_ON_JOB_CLOSE, inherited by all descendants.
      int size=Marshal.SizeOf(limits); IntPtr ptr=Marshal.AllocHGlobal(size);
      try { Marshal.StructureToPtr(limits,ptr,false); if(!SetInformationJobObject(job,9,ptr,(uint)size)) throw new System.ComponentModel.Win32Exception(); }
      finally { Marshal.FreeHGlobal(ptr); }
      if(!Alive(owner,ownerStart) || File.Exists(cancel)) return 130;
      var si=new STARTUPINFO(); si.cb=Marshal.SizeOf(si); si.flags=0x100;
      si.input=GetStdHandle(-10); si.output=GetStdHandle(-11); si.error=GetStdHandle(-12);
      var command=new StringBuilder(Quote(exe)); foreach(var arg in args) command.Append(" ").Append(Quote(arg));
      if(!CreateProcess(exe,command,IntPtr.Zero,IntPtr.Zero,true,0x08000004,IntPtr.Zero,cwd,ref si,out pi)) throw new System.ComponentModel.Win32Exception();
      started=true;
      if(!AssignProcessToJobObject(job,pi.process)) throw new System.ComponentModel.Win32Exception();
      var child=Process.GetProcessById(pi.pid);
      File.WriteAllText(registry,"{\"pid\":"+pi.pid+",\"start\":\""+child.StartTime.ToUniversalTime().Ticks+"\",\"role\":\"worker\"}");
      if(!Alive(owner,ownerStart) || File.Exists(cancel)) return 130;
      if(ResumeThread(pi.thread)==0xffffffff) throw new System.ComponentModel.Win32Exception();
      while(WaitForSingleObject(pi.process,100)==258) if(!Alive(owner,ownerStart) || File.Exists(cancel)) return 130;
      uint exitCode; if(!GetExitCodeProcess(pi.process,out exitCode)) throw new System.ComponentModel.Win32Exception();
      return (int)exitCode;
    } finally {
      if(started) { TerminateProcess(pi.process,130); CloseHandle(pi.thread); CloseHandle(pi.process); }
      CloseHandle(job);
    }
  }
}
'@
try {
  $code = [CcaJob]::Run($s.command, [string[]]$s.args, $s.cwd, [int]$s.owner.pid, [string]$s.owner.start, $s.cancel, $s.registry)
  exit $code
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 70 }
